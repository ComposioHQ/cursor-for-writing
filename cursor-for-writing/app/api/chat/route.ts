import { NextResponse } from 'next/server';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google'
import { VercelAIToolSet } from 'composio-core';
import { generateText } from 'ai';

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
        ? `${toolInfoForPrompt}User request: "${message}"

You are editing specific portions of a document. Below are the selected text portions to modify:

${selections.map((s: Selection, i: number) => `
Selection ${i + 1} (from position ${s.from} to ${s.to}, file: ${s.fileName || 'current'}):
---
${s.text}
---
`).join('\n')}

${currentContent ? `Full document context for reference:
---
${currentContent}
---` : 'No full document context provided.'}

Based on the user request, please modify ONLY the selected text portions while preserving their original positions.
Format your response as a JSON array of modifications, using plain text for the newText field (no HTML):

{
  "modifications": [
    {
      "from": <start_position>,
      "to": <end_position>,
      "newText": "modified text content in plain text format",
      "explanation": "Brief explanation of what was changed and why"
    },
    ...
  ]
}

Important: Do not use HTML tags in the newText field. Provide all content in plain text format only.
Do not include explanations or any other text outside the JSON structure.`
        : `${toolInfoForPrompt}User request: "${message}"

${currentContent ? `Current document content:
---
${currentContent}
---

Based on the user request, please modify or generate document content.
` : 'Please generate new content based on the user request.'}
Follow these formatting rules strictly:
1. Use standard Markdown syntax (e.g., # for headings, * or - for lists, **bold**, _italic_, etc.).
2. Use double line breaks between paragraphs.
3. Ensure proper Markdown formatting for quotes, code blocks, etc.
4. Do NOT include any HTML tags.

Output ONLY the complete, modified document content in standard Markdown format.
Do not include explanations or introductions.`
      : `${toolInfoForPrompt}You are a helpful assistant capable of using tools. The user has provided the following context:

${selections?.length
  ? `Selected text:
${selections.map(s => `\n(File: ${s.fileName || 'current'}) ---\n${s.text}\n---`).join('\n')}`
  : currentContent
  ? `Current document content:
---
${currentContent}
---`
  : `No specific text context provided.`}

User's request: "${message}"

Important instructions:
1. Address the user's request directly.
2. If tools (${mentionedToolIds.length > 0 ? mentionedToolIds.join(', ') : 'none specified'}) are available and relevant, use them. 
3. If the request involves searching, summarizing, or interacting with external services mentioned in the available tools, perform the action and report the results.
4. If the request is a general question or requires information, provide a clear and concise answer.
5. Format your response as plain text suitable for a chat interface. Do not use HTML or Markdown extensively unless necessary for clarity (like code snippets).
6. Do not ask follow-up questions unless absolutely necessary to clarify the request.

Respond directly to the user's request.`

    // Note: The previous way of splitting basePrompt and prepending was likely causing syntax issues.
    // This approach directly includes toolInfoForPrompt at the start of each relevant prompt branch.

    try {
      // Initialize toolset inside the request handler with the API key
      const toolset = new VercelAIToolSet({ apiKey: composioApiKey}); // Pass apiKey here
      
      // Only load tools if any were mentioned
      let output;
      
      if (mentionedToolIds.length > 0) {
        // Load tools and include them in the API call
        const tools = await toolset.getTools({ apps: appsToLoad, actions:[] });
        output = await generateText({
          ...aiConfig,
          tools,
          maxSteps: 10,
          prompt,
        });
      } else {
        // Make the call without any tools parameter
        output = await generateText({
          ...aiConfig,
          maxSteps: 10,
          prompt,
        });
      }

      if (mode === 'agent') {
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