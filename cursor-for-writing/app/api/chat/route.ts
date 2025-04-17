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
  model: openai('gpt-4o'),
  temperature: 0.7,
};

// Schema for the connection check response
const ConnectionCheckSchema = z.object({
  needsInitiation: z.boolean().describe("True if the connection needs to be initiated, false otherwise."),
  initiationUrl: z.string().nullable().optional().describe("The URL to initiate the connection if needsInitiation is true."),
  message: z.string().describe("A message for the user about the connection status or required action."),
});

export async function POST(request: Request) {
  try {
    const { message, currentContent, selections, mode = 'agent', composioApiKey } = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Define available tools and their mapping
    const availableToolsMap: { [key: string]: string } = {
      'composio_search': 'COMPOSIO_SEARCH',
      'googledocs': 'GOOGLEDOCS',
      'gmail':'GMAIL',
      'notion': 'NOTION',
      'linkedin': 'LINKEDIN',
      'twitter': 'TWITTER',
      'typefully': 'TYPEFULLY'
    };

    // Helper function to extract tool mentions
    const extractToolMentions = (text: string): string[] => {
      const mentionRegex = /@([a-zA-Z0-9_]+)/g;
      const mentions = text.match(mentionRegex);
      if (!mentions) return [];
      return mentions
        .map(mention => mention.substring(1).toLowerCase())
        .filter(name => availableToolsMap[name])
        .map(name => availableToolsMap[name]);
    };

    // Determine which tools to load based on mentions
    const mentionedToolIds = extractToolMentions(message);
    // Only load tools that are specifically mentioned, otherwise use empty array
    const appsToLoad = mentionedToolIds.length > 0 ? mentionedToolIds : [];

    // Remove mentions from the message passed to the AI if needed, or keep them for context
    // const cleanMessage = message.replace(/@([a-zA-Z0-9_]+)/g, '').trim();
    // Use `message` directly if you want the AI to see the mentions

    // Construct prompt, potentially indicating available tools
    let toolInfoForPrompt = "";
    if (mentionedToolIds.length > 0) {
        toolInfoForPrompt = `You have the following tools available for this request: ${mentionedToolIds.join(', ')}. Use them if appropriate.\n\n`;
    }

    // Different prompts for different modes
    const prompt = mode === 'write'
      ? selections?.length
        ? `${toolInfoForPrompt}User request: \"${message}\"\n\nYou are editing specific portions of a document. Below are the selected text portions to modify:\n\n${selections.map((s: Selection, i: number) => `\nSelection ${i + 1} (from position ${s.from} to ${s.to}, file: ${s.fileName || 'current'}):\n---\n${s.text}\n---\n`).join('\n')}\n\n${currentContent ? `Full document context for reference:\n---\n${currentContent}\n---` : 'No full document context provided.'}\n\nBased on the user request, please modify ONLY the selected text portions while preserving their original positions.\nFormat your response as a JSON array of modifications, using plain text for the newText field (no HTML):\n\n{\n  \"modifications\": [\n    {\n      \"from\": <start_position>,\n      \"to\": <end_position>,\n      \"newText\": \"modified text content in plain text format\",\n      \"explanation\": \"Brief explanation of what was changed and why\"\n    },\n    ...\n  ]\n}\n\nImportant: Do not use HTML tags in the newText field. Provide all content in plain text format only.\nDo not include explanations or any other text outside the JSON structure.`
        : `${toolInfoForPrompt}User request: \"${message}\"\n\n${currentContent ? `Current document content:\n---\n${currentContent}\n---\n\nBased on the user request, please modify or generate document content.\n` : 'Please generate new content based on the user request.'}\nFollow these formatting rules strictly:\n1. Use standard Markdown syntax (e.g., # for headings, * or - for lists, **bold**, _italic_, etc.).\n2. Use double line breaks between paragraphs.\n3. Ensure proper Markdown formatting for quotes, code blocks, etc.\n4. Do NOT include any HTML tags.\n\nOutput ONLY the complete, modified document content in standard Markdown format.\nDo not include explanations or introductions.`
      : `${toolInfoForPrompt}You are a helpful assistant capable of using tools. The user has provided the following context:\n\n${selections?.length
  ? `Selected text:\n${selections.map(s => `\n(File: ${s.fileName || 'current'}) ---\n${s.text}\n---`).join('\n')}`
  : currentContent
  ? `Current document content:\n---\n${currentContent}\n---`
  : `No specific text context provided.`}\n\nUser's request: \"${message}\"\n\nImportant instructions:\n1. Address the user's request directly.\n2. If tools (${mentionedToolIds.length > 0 ? mentionedToolIds.join(', ') : 'none specified'}) are available and relevant, use them ONLY if the connection is active.\n3. If the current message appears to contain credentials or parameters (like an API key) specifically requested in a previous turn for a tool connection (e.g., Typefully API Key), your ABSOLUTE FIRST PRIORITY is to use the \`COMPOSIO_INITIATE_CONNECTION\` tool. Extract the necessary credential (e.g., the API key) from the user's message and pass it to the tool. Do not attempt any other action or tool use until this connection is successfully established. After successful connection, confirm with the user.\n4. If the user's request seems intended for a specific tool (like getting parameters or performing an action) but they haven't tagged the tool using '@tool_name', ask them to clarify by tagging the intended tool.\n5. For general requests or questions not involving tools or connection setup, provide a clear and concise answer.\n6. Do not ask follow-up questions unless absolutely necessary to clarify the request.\n\nRespond directly according to these priorities.`

    // Note: The previous way of splitting basePrompt and prepending was likely causing syntax issues.
    // This approach directly includes toolInfoForPrompt at the start of each relevant prompt branch.

    try {
      // Initialize toolset inside the request handler with the API key
      const toolset = new VercelAIToolSet({ apiKey: composioApiKey }); // Pass apiKey here
      
      // --- Check if message likely contains credentials --- 
      const credentialKeywords = ['api key', 'token', 'bearer', 'password', 'secret'];
      const likelyContainsCredentials = credentialKeywords.some(keyword => message.toLowerCase().includes(keyword)) || /sk-[a-zA-Z0-9]+/.test(message); // Basic check

      // Only load tools if any were mentioned
      let output;
      let connectionCheckPassed = false; // Flag to indicate connection is okay
      
      if (mentionedToolIds.length > 0 && !likelyContainsCredentials) {
        // --- Initial Connection Check (Only run if tool mentioned AND no credentials likely present) --- 

        // 1. Check connection status first
        const connectionCheckTools = await toolset.getTools({
          actions: ['COMPOSIO_CHECK_ACTIVE_CONNECTION', 'COMPOSIO_INITIATE_CONNECTION', 'COMPOSIO_GET_REQUIRED_PARAMETERS']
        });

        const connectionCheckPrompt = `Check the connection status for the following tool(s): ${mentionedToolIds.join(', ')}. Use the COMPOSIO_CHECK_ACTIVE_CONNECTION tool. If the connection is inactive, use the COMPOSIO_INITIATE_CONNECTION tool to get the initiation URL.

Respond ONLY with a valid JSON object adhering to the following structure (do NOT include any other text or markdown formatting):
{
  "needsInitiation": boolean, // true if connection needs initiation, false otherwise
  "initiationUrl": string | null, // URL if initiation is needed, null otherwise
  "message": string // User-friendly message about status/action
}`;

        // Use generateText and parse the response
        const connectionResultRaw = await generateText({
          model: aiConfig.model,
          tools: connectionCheckTools,
          prompt: connectionCheckPrompt,
          temperature: 0.2, 
          maxSteps: 10, 
        });

        let connectionCheckResult: z.infer<typeof ConnectionCheckSchema>;
        try {
          // Attempt to parse the JSON response
          const jsonString = connectionResultRaw.text.trim();
          
          // Remove potential markdown fences
          let potentialJson = jsonString;
          if (potentialJson.startsWith('```json\n') && potentialJson.endsWith('\n```')) {
            potentialJson = potentialJson.slice(7, -4).trim();
          } else if (potentialJson.startsWith('```') && potentialJson.endsWith('```')) { // Handle case without explicit json tag
            potentialJson = potentialJson.slice(3, -3).trim();
          }

          // Now parse the cleaned string
          if (!potentialJson.startsWith('{') || !potentialJson.endsWith('}')) {
            throw new Error('AI response, after cleaning fences, is not a valid JSON object string.');
          }
          const parsedJson = JSON.parse(potentialJson);
          connectionCheckResult = ConnectionCheckSchema.parse(parsedJson);
        } catch (parseError) {
          console.error('Failed to parse connection check JSON:', parseError, 'Raw text:', connectionResultRaw.text);
          // Fallback: Assume connection is okay but notify user of parsing issue
          return NextResponse.json({ 
             type: 'chat',
             chatResponse: "Could not reliably check tool connection status. Proceeding with caution."
          });
        }

        if (connectionCheckResult.needsInitiation) {
          // If connection needs initiation, return the URL and message
          return NextResponse.json({
            type: 'connection_required',
            message: connectionCheckResult.message,
            initiationUrl: connectionCheckResult.initiationUrl,
          });
        }

        // If we reach here after the check, it means connection is okay
        connectionCheckPassed = true;

      } // End of initial connection check block

      // --- Main Agent Logic --- 
      // Runs if:
      // 1. No tool mentioned.
      // 2. Tool mentioned AND credentials likely present (check skipped).
      // 3. Tool mentioned, no credentials, AND connection check passed.
 
      if (!mentionedToolIds.length || likelyContainsCredentials || connectionCheckPassed) {
        // 2. If connection is active, proceed with the original request
        const mainTools = await toolset.getTools({ apps: appsToLoad, actions: ['COMPOSIO_CHECK_ACTIVE_CONNECTION', 'COMPOSIO_INITIATE_CONNECTION', 'COMPOSIO_GET_REQUIRED_PARAMETERS'] });

        // Construct the correct prompt based on the mode
        const prompt = mode === 'write'
          ? selections?.length
            ? `${toolInfoForPrompt}User request: \"${message}\"\n\nYou are editing specific portions of a document. Below are the selected text portions to modify:\n\n${selections.map((s: Selection, i: number) => `\nSelection ${i + 1} (from position ${s.from} to ${s.to}, file: ${s.fileName || 'current'}):\n---\n${s.text}\n---\n`).join('\n')}\n\n${currentContent ? `Full document context for reference:\n---\n${currentContent}\n---` : 'No full document context provided.'}\n\nBased on the user request, please modify ONLY the selected text portions while preserving their original positions.\nFormat your response as a JSON array of modifications, using plain text for the newText field (no HTML):\n\n{\n  \"modifications\": [\n    {\n      \"from\": <start_position>,\n      \"to\": <end_position>,\n      \"newText\": \"modified text content in plain text format\",\n      \"explanation\": \"Brief explanation of what was changed and why\"\n    },\n    ...\n  ]\n}\n\nImportant: Do not use HTML tags in the newText field. Provide all content in plain text format only.\nDo not include explanations or any other text outside the JSON structure.`
            : `${toolInfoForPrompt}User request: \"${message}\"\n\n${currentContent ? `Current document content:\n---\n${currentContent}\n---\n\nBased on the user request, please modify or generate document content.\n` : 'Please generate new content based on the user request.'}\nFollow these formatting rules strictly:\n1. Use standard Markdown syntax (e.g., # for headings, * or - for lists, **bold**, _italic_, etc.).\n2. Use double line breaks between paragraphs.\n3. Ensure proper Markdown formatting for quotes, code blocks, etc.\n4. Do NOT include any HTML tags.\n\nOutput ONLY the complete, modified document content in standard Markdown format.\nDo not include explanations or introductions.`
          : `${toolInfoForPrompt}You are a helpful assistant capable of using tools. The user has provided the following context:\n\n${selections?.length
    ? `Selected text:\n${selections.map(s => `\n(File: ${s.fileName || 'current'}) ---\n${s.text}\n---`).join('\n')}`
    : currentContent
    ? `Current document content:\n---\n${currentContent}\n---`
    : `No specific text context provided.`}\n\nUser's request: \"${message}\"\n\nImportant instructions:\n1. Address the user's request directly.\n2. If tools (${mentionedToolIds.length > 0 ? mentionedToolIds.join(', ') : 'none specified'}) are available and relevant, use them ONLY if the connection is active.\n3. If the current message appears to contain credentials or parameters (like an API key) specifically requested in a previous turn for a tool connection (e.g., Typefully API Key), your ABSOLUTE FIRST PRIORITY is to use the \`COMPOSIO_INITIATE_CONNECTION\` tool. Extract the necessary credential (e.g., the API key) from the user's message and pass it to the tool. Do not attempt any other action or tool use until this connection is successfully established. After successful connection, confirm with the user.\n4. If the user's request seems intended for a specific tool (like getting parameters or performing an action) but they haven't tagged the tool using '@tool_name', ask them to clarify by tagging the intended tool.\n5. For general requests or questions not involving tools or connection setup, provide a clear and concise answer.\n6. Do not ask follow-up questions unless absolutely necessary to clarify the request.\n\nRespond directly according to these priorities.`

        output = await generateText({
          ...aiConfig,
          tools: mainTools, // Use the originally requested tools
          maxSteps: 10,
          prompt,
        });
      }

      if (mode === 'agent' && output) { // Check if output exists before accessing .text
        // For agent mode, return the response as chat output
        // Future: Could parse output for structured actions if needed
        return NextResponse.json({ 
          chatResponse: output.text, 
          type: 'chat' 
        });
      } else if (mode === 'write') {
        // For write mode, handle document modifications
        if (selections?.length) {
          try {
            // More flexible regex to find JSON block within ```json ... ```
            const jsonRegex = /```json\s*([\s\S]+?)\s*```/;
            const match = output.text.match(jsonRegex);
            
            let jsonStringToParse;
            if (match && match[1]) {
              // If regex matches, use the captured group (the JSON part)
              jsonStringToParse = match[1].trim();
            } else {
              // If no match, try parsing the whole text (in case AI didn't use fences)
              // But first, check if it *looks* like it starts with JSON object/array
              const trimmedOutput = output.text.trim();
              if (trimmedOutput.startsWith('{') || trimmedOutput.startsWith('[')) {
                jsonStringToParse = trimmedOutput;
              } else {
                // If it doesn't look like JSON and didn't match regex, throw error
                throw new Error('AI output does not contain a recognizable JSON block.');
              }
            }
            
            // Attempt to parse the string we determined might be JSON
            const modificationsData = JSON.parse(jsonStringToParse); 
            
            // Ensure modificationsData has the expected structure
            if (modificationsData && modificationsData.modifications && Array.isArray(modificationsData.modifications)) {
              return NextResponse.json({ 
                modifications: modificationsData.modifications, // Send only the modifications array
                type: 'modification'
              });
            } else {
              // Throw an error if the parsed structure is not as expected
              throw new Error('Parsed JSON does not contain a valid "modifications" array.');
            }
          } catch (parseError) {
            console.error('Failed to parse modifications JSON:', parseError, 'Raw text:', output.text);
            // Fallback: If JSON parsing fails, return error
            return NextResponse.json({ 
              error: "AI returned modifications in an invalid format or the format could not be extracted.",
            }, { status: 400 }); // Indicate bad data from AI
          }
        } else {
          return NextResponse.json({ 
            modifiedContent: output.text,
            explanation: "Complete document was modified based on your request",
            type: 'replacement'
          });
        }
      }
    } catch (aiError) {
      console.error('AI Generation Error:', aiError);
      return NextResponse.json({ 
        error: 'AI failed to generate content',
        details: aiError instanceof Error ? aiError.message : 'Unknown error'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json({
      error: 'Failed to process chat request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 