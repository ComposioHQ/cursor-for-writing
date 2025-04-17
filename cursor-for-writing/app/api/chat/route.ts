import { NextResponse } from 'next/server';
import { openai } from '@ai-sdk/openai';
import { VercelAIToolSet } from 'composio-core';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';

interface Selection {
  text: string;
  from: number;
  to: number;
  fileName?: string;
}

// Initialize the AI configuration
const aiConfig = {
  model: openai('gpt-4.1-nano'),
  temperature: 0.7,
};

// Expanded Schema for connection check response
const ConnectionCheckSchema = z.object({
  needsInitiation: z.boolean().describe("True if the connection needs to be initiated, false otherwise."),
  connectionType: z.enum(['API_KEY', 'OAUTH2', 'OTHER', 'NONE']).describe("Type of connection needed: API_KEY, OAUTH2, OTHER, or NONE."),
  // Ensure parameterName is nullable AND optional, as it only applies to API_KEY
  parameterName: z.string().nullable().optional().describe("The name of the parameter needed ONLY if connectionType is API_KEY (e.g., 'api_key'). Should be null otherwise."),
  initiationUrl: z.string().nullable().optional().describe("The URL ONLY if connectionType is OAUTH2. Should be null otherwise."),
  message: z.string().describe("A user-friendly message about the connection status or required action."),
});

export async function POST(request: Request) {
  try {
    const {
      message,
      currentContent,
      selections,
      mode = 'agent',
      composioApiKey,
      connectionParams, // Check for this new field
      targetTool        // Check for this new field
    } = await request.json();

    // --- Direct Connection Initiation Handling ---
    if (connectionParams && targetTool && composioApiKey) {
      const toolset = new VercelAIToolSet({ apiKey: composioApiKey });
      try {
        // Fetch only the necessary connection tools
        const connectionInitiationTools = await toolset.getTools({
          // Assuming tool actions are global, not app-specific for these core actions
          // If they are app-specific, might need apps: [targetTool] if targetTool maps to an app ID
          actions: ['COMPOSIO_INITIATE_CONNECTION', 'COMPOSIO_CHECK_ACTIVE_CONNECTION', 'COMPOSIO_GET_REQUIRED_PARAMETERS'] 
        });

        // Construct prompt for the LLM to perform initiation and check
        const initiationPrompt = `You MUST perform the following actions in sequence for the tool '${targetTool}':
1. Call the 'COMPOSIO_INITIATE_CONNECTION' tool, passing these parameters exactly: ${JSON.stringify(connectionParams)}. Handle any immediate errors from this tool call.
2. Immediately after the initiate call (whether it seemed successful or not), call the 'COMPOSIO_CHECK_ACTIVE_CONNECTION' tool for the same tool '${targetTool}'.
3. Based *only* on the result of the 'COMPOSIO_CHECK_ACTIVE_CONNECTION' call: if the connection is now active, respond with the single word 'SUCCESS'. Otherwise, respond with the single word 'FAILURE'.
Do NOT include any other text, explanation, or formatting in your response. Only 'SUCCESS' or 'FAILURE'.`;

        // Call generateText to execute the sequence
        const llmResponse = await generateText({
            model: aiConfig.model,
            tools: connectionInitiationTools,
            prompt: initiationPrompt,
            temperature: 0.0, // Set temperature to 0 for deterministic response
            maxSteps: 20 // Limit steps for this specific task
        });

        const resultText = llmResponse.text.trim();

        if (resultText === 'SUCCESS') {
            return NextResponse.json({
              message: `Successfully connected to ${targetTool}! You can now use the tool.`,
              type: 'connection_success'
            });
        } else {
            // This means the LLM reported FAILURE based on the check
            throw new Error(`LLM reported connection failure for ${targetTool} after initiation attempt. Check tool status or credentials.`);
        }

      } catch (connectionError) {
        return NextResponse.json({ 
           error: `Failed to connect to ${targetTool}. Please check credentials or try again.`,
           details: connectionError instanceof Error ? connectionError.message : 'Unknown connection error'
         }, { status: 500 });
      }
    }
    // --- End Direct Connection Handling ---

    // If not a direct connection request, proceed with normal logic:
    if (!message && !connectionParams) { // Message required only if not connecting
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // --- Tool Extraction & Mapping --- 
    const availableToolsMap: { [key: string]: string } = {
      'composio_search': 'COMPOSIO_SEARCH',
      'googledocs': 'GOOGLEDOCS',
      'gmail':'GMAIL',
      'notion': 'NOTION',
      'linkedin': 'LINKEDIN',
      'twitter': 'TWITTER',
      'typefully': 'TYPEFULLY',
      'youtube': 'YOUTUBE',
      'discord': 'DISCORD'
    };
    const extractToolMentions = (text: string): string[] => {
      if (!text) return [];
      const mentionRegex = /@([a-zA-Z0-9_]+)/g;
      const mentions = text.match(mentionRegex);
      if (!mentions) return [];
      return mentions
        .map(mention => mention.substring(1).toLowerCase())
        .filter(name => availableToolsMap[name])
        .map(name => availableToolsMap[name]);
    };
    const mentionedToolIds = extractToolMentions(message || ''); // Use message if available
    const appsToLoad = mentionedToolIds.length > 0 ? mentionedToolIds : [];
    let toolInfoForPrompt = "";
    if (mentionedToolIds.length > 0) {
        toolInfoForPrompt = `Tool context: ${mentionedToolIds.join(', ')}. `;
    }
    // ---

    // Initialize toolset for subsequent logic if needed
    const toolset = new VercelAIToolSet({ apiKey: composioApiKey });

    // Declare connectionCheckPassed outside the conditional block
    let connectionCheckPassed = false; 
    let connectionCheckResult: z.infer<typeof ConnectionCheckSchema> | null = null; // Allow null

    // --- Check if message likely contains credentials --- 
    const credentialKeywords = ['api key', 'token', 'bearer', 'password', 'secret'];
    const likelyContainsCredentials = message ? (credentialKeywords.some(keyword => message.toLowerCase().includes(keyword)) || /sk-[a-zA-Z0-9]+/.test(message)) : false;

    // Only load tools if any were mentioned (for main agent logic)
    let output;

    if (mentionedToolIds.length > 0 && !likelyContainsCredentials) {
      // --- Initial Connection Check (Only if tool mentioned AND no credentials likely present) ---
      const connectionCheckTools = await toolset.getTools({
        actions: ['COMPOSIO_CHECK_ACTIVE_CONNECTION', 'COMPOSIO_INITIATE_CONNECTION', 'COMPOSIO_GET_REQUIRED_PARAMETERS']
      });

      // More robust prompt for connection check
      const connectionCheckPrompt = `Check connection status for: ${mentionedToolIds.join(', ')}. Use COMPOSIO_CHECK_ACTIVE_CONNECTION.
If inactive:
- Use COMPOSIO_GET_REQUIRED_PARAMETERS. Determine type ('API_KEY', 'OAUTH2', 'OTHER').
- If API_KEY, find the exact parameter name (e.g., 'api_key', 'apiKey'). Set parameterName.
- If OAUTH2, use COMPOSIO_INITIATE_CONNECTION to get the initiationUrl. Set initiationUrl.
- Set needsInitiation=true. Set connectionType.
If active: needsInitiation=false, connectionType='NONE'.
Respond ONLY with JSON matching this structure:
{
"needsInitiation": boolean,
"connectionType": "API_KEY"|"OAUTH2"|"OTHER"|"NONE",
"parameterName": string|null, 
"initiationUrl": string|null,
"message": string
}`; 

      const connectionResultRaw = await generateText({
        model: aiConfig.model,
        tools: connectionCheckTools,
        prompt: connectionCheckPrompt,
        temperature: 0.1, // Lower temp for structure
        maxSteps: 20, 
      });

      try {
        let potentialJson = connectionResultRaw.text.trim();
        if (potentialJson.startsWith('```json\\n') && potentialJson.endsWith('\\n```')) {
          potentialJson = potentialJson.slice(7, -4).trim();
        } else if (potentialJson.startsWith('```') && potentialJson.endsWith('```')) {
           potentialJson = potentialJson.slice(3, -3).trim();
        }
        if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) {
          throw new Error('Cleaned AI response is not valid JSON object string.');
        }
        const parsedJson = JSON.parse(potentialJson);
        connectionCheckResult = ConnectionCheckSchema.parse(parsedJson);
      } catch (parseError) {
        // Catch parsing error, maybe return generic message
        return NextResponse.json({
           type: 'chat',
           chatResponse: "Could not reliably check tool connection status. Please try again."
        });
      }

      if (connectionCheckResult.needsInitiation) {
        return NextResponse.json({
          type: 'connection_required',
          connectionType: connectionCheckResult.connectionType,
          message: connectionCheckResult.message,
          parameterName: connectionCheckResult.parameterName, // Pass these to frontend
          initiationUrl: connectionCheckResult.initiationUrl, // Pass these to frontend
        });
      } else {
        connectionCheckPassed = true; // Connection is okay
      }
    } // End of initial connection check block

    // Declare mainTools here so it's available for usability check and main logic
    let mainTools: any = {}; // Use 'any' or a more specific tool type if available
    if (appsToLoad.length > 0) {
        mainTools = await toolset.getTools({ apps: appsToLoad }); 
    }

    // --- API Usability Check (if connection check passed) ---
    if (connectionCheckPassed && appsToLoad.length > 0) {
      const firstToolId = appsToLoad[0]; // Check the first mentioned tool
      // Simple, read-only test actions map
      const testActions: { [key: string]: string } = {
        'YOUTUBE': 'YOUTUBE_LIST_USER_PLAYLISTS',
        'GOOGLEDOCS': 'GOOGLEDOCS_LIST_DOCUMENTS', // Example, adjust as needed
        'GMAIL': 'GMAIL_LIST_LABELS',           // Example, adjust as needed
        'NOTION': 'NOTION_LIST_DATABASES',      // Example, adjust as needed
        // Add other relevant test actions here
      };
      const testAction = testActions[firstToolId];

      if (testAction && mainTools[testAction]) {
        try {
          const testPrompt = `Perform a quick test to verify the ${firstToolId} API is usable by calling the '${testAction}' action with minimal parameters (e.g., limit results to 1 if possible). Respond only with the tool result, no conversational text.`;
          const testResult = await generateText({
            model: aiConfig.model, // Use a fast model if possible
            tools: { [testAction]: mainTools[testAction] }, // Only provide the test tool
            prompt: testPrompt,
            temperature: 0.0,
            maxSteps: 5, // Limit steps for the test
          });

          // Check for specific failure patterns in toolResults
          if (testResult.toolResults && testResult.toolResults.length > 0) {
              const resultDataString = typeof testResult.toolResults[0].result === 'string'
                  ? testResult.toolResults[0].result
                  : JSON.stringify(testResult.toolResults[0].result);

              // Look for the YouTube API not enabled error specifically
              // Example Error: "YouTube Data API v3 has not been used in project ... before or it is disabled."
              // Example Status Code: 403
              const youtubeApiDisabledRegex = /YouTube Data API v3 has not been used.*?before or it is disabled/i;
              const forbiddenErrorRegex = /"status_code":\s*403/i; // More generic Forbidden check
              
              if (youtubeApiDisabledRegex.test(resultDataString) || forbiddenErrorRegex.test(resultDataString)) {
                   // Extract project ID if available from youtube error
                   const projectMatch = resultDataString.match(/project (\d+)/);
                   const projectId = projectMatch ? projectMatch[1] : 'your';
                   const failureMessage = `The connection for ${firstToolId} seems okay, but the underlying API (e.g., YouTube Data API v3 in project ${projectId}) might be disabled or misconfigured. Please check its status in the Google Cloud Console (or relevant provider console) and try again.`;
                   return NextResponse.json({
                       type: 'chat',
                       chatResponse: failureMessage
                   });
              }
          }
        } catch (testError) {
          // Decide if we should halt or proceed carefully - maybe log internally?
        }
      }
    }
    // --- End API Usability Check ---

    // --- Main Agent Logic --- 
    if (message && (!mentionedToolIds.length || likelyContainsCredentials || connectionCheckPassed)) {
      // mainTools are already loaded above if appsToLoad was not empty
 
      // Use the correct agent prompt (ensure Instruction #3 is the explicit one)
      const prompt = mode === 'write' 
        ? (selections?.length 
            ? `${toolInfoForPrompt}User request: \"${message}\"\n\nYou are editing the following selection(s):\n${selections.map(s => `- ${s.text.substring(0, 50)}...`).join('\n')}\n\nBased ONLY on the user request and the selection(s), provide JSON output containing the necessary modifications in the specified format. Do not add conversational text.` 
            : `${toolInfoForPrompt}User request: \"${message}\"\n\n${currentContent ? `Current document content:\n${currentContent}\n\nBased ONLY on the user request and the current document, rewrite the entire content.` : 'The document is currently empty. Based ONLY on the user request, generate the new content.'}`)
        : `${toolInfoForPrompt}You are a helpful assistant coordinating actions based on user requests. User's request: \"${message}\"\n\nImportant instructions:\n1. Analyze the user's request to determine the required action and any necessary tools (mentioned with '@').\n2. If tools are mentioned (@toolname), check if their connections are active using 'COMPOSIO_CHECK_ACTIVE_CONNECTION'. If not active, inform the user about the connection requirement.\n3. If the current message appears to contain credentials (API key, token, password, secret, bearer, sk-...), consider this message as the user explicitly asking to connect. Your ABSOLUTE FIRST PRIORITY is to use the \`COMPOSIO_INITIATE_CONNECTION\` tool with the provided credentials for the mentioned tool. Respond ONLY with the outcome of the connection attempt (success or failure message).\n4. If the required tools are connected (or no tools are needed), execute the user's request. Use the available tools if necessary. If no tools are needed, provide a direct text response.\n5. Respond directly according to these priorities. Provide only the final answer or the result of the tool action. Do not add conversational filler.`; // Refined prompt structure

      output = await generateText({
        ...aiConfig,
        tools: mainTools,
        prompt,
        maxSteps: 10,
      });

    } // End of main agent logic block

    // --- Process Output --- 
    if (!output && !connectionCheckPassed && mentionedToolIds.length > 0 && !likelyContainsCredentials) {
        // This case should ideally be handled by the connection check returning earlier
        // but as a fallback, if no output was generated and connection wasn't confirmed needed/passed
        return NextResponse.json({ type: 'chat', chatResponse: 'Could not determine the next step.' });
    } 

    if (output) { // Only process if output was generated
      if (mode === 'agent') {
        return NextResponse.json({ 
          chatResponse: output.text, 
          type: 'chat' 
        });
      } else if (mode === 'write') {
        if (selections?.length) {
          try {
             // ... existing JSON parsing for modifications ...
             const jsonRegex = /```json\s*([\s\S]+?)\s*```/;
             const match = output.text.match(jsonRegex);
             let jsonStringToParse = output.text.trim();
             if (match && match[1]) {
               jsonStringToParse = match[1].trim();
             } else if (!(jsonStringToParse.startsWith('{') || jsonStringToParse.startsWith('['))) {
                 throw new Error('AI output does not contain a recognizable JSON block.');
             }
             const modificationsData = JSON.parse(jsonStringToParse);
             if (modificationsData && modificationsData.modifications && Array.isArray(modificationsData.modifications)) {
               return NextResponse.json({ modifications: modificationsData.modifications, type: 'modification' });
             } else {
               throw new Error('Parsed JSON does not contain a valid "modifications" array.');
             }
          } catch (parseError) {
            // Catch modification parsing error
            return NextResponse.json({ error: "AI returned modifications in invalid format." }, { status: 400 }); 
          }
        } else {
          // Full replacement
          return NextResponse.json({ 
            modifiedContent: output.text,
            explanation: "Complete document modified.",
            type: 'replacement'
          });
        }
      }
    } else if (!connectionCheckPassed && mentionedToolIds.length > 0 && likelyContainsCredentials) {
        // If connection check was skipped due to credentials, but main agent didn't produce output (e.g., failed connection attempt)
        // We might need a more specific error message here, possibly derived from tool execution logs if available
        return NextResponse.json({ type: 'chat', chatResponse: 'Attempted to use credentials, but could not complete the action.' });
    } else if (!output && !mentionedToolIds.length) {
        // No tool, no creds, no check ran, and no output from main agent (e.g., simple message)
        // This might indicate an issue or just an empty response needed?
        return NextResponse.json({ type: 'chat', chatResponse: 'Received empty request.' });
    }
    
    // Fallback if no other condition was met (should ideally not be reached)
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 });

  } catch (error) {
     // Catch top-level error
     return NextResponse.json({
       error: 'Failed to process chat request',
       details: error instanceof Error ? error.message : 'Unknown error'
     }, { status: 500 });
  }
} 