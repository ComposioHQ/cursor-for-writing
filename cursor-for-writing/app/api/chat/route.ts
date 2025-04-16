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
      'twitter': 'TWITTER'
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
    const prompt = mode === 'agent'
      ? selections?.length
        ? `${toolInfoForPrompt}User request: "${message}"

You are editing specific portions of a document. Below are the selected text portions to modify:

${selections.map((s: Selection, i: number) => `
Selection ${i + 1} (from position ${s.from} to ${s.to}):
---
${s.text}
---
`).join('\n')}

Full document context for reference:
---
${currentContent}
---

Based on the user request, please modify ONLY the selected text portions while preserving their original positions.
For each selection, provide the modified text that should replace it and an explanation of the changes.
Format your response as a JSON array of modifications:

{
  "modifications": [
    {
      "from": <start_position>,
      "to": <end_position>,
      "newText": "modified text content",
      "explanation": "Brief explanation of what was changed and why"
    },
    ...
  ]
}

Do not include explanations or any other text outside the JSON structure.`
        : `${toolInfoForPrompt}User request: "${message}"

${currentContent ? `Current document content:
---
${currentContent}
---

Based on the user request, please modify or generate document content.
` : 'Please generate new content based on the user request.'}
Follow these formatting rules strictly:
1. Use proper markdown formatting
2. Start with a single # for the main title
3. Use double line breaks (\\n\\n) between paragraphs
4. Properly format quotes with "quotation marks"
5. Use proper punctuation and spacing
6. Do not use horizontal rules (---)

Output ONLY the complete, modified document content, formatted as Markdown.
Do not include explanations or introductions.`
      : `${toolInfoForPrompt}You are a helpful writing assistant. The user has provided the following context:

${selections?.length
  ? `Selected text:\n${selections.map(s => `\\n---\\n${s.text}\\n---`).join('\\n')}`
  : currentContent
  ? `Selected text:\n---
${currentContent}\n---`
  : `No specific text context provided.`}

User's request: "${message}"

Provide helpful feedback, suggestions, edits, or answers based on the user's request and the provided context. Respond directly to the user's request in a conversational but informative manner. Focus on being a helpful writing assistant.`;

    // Note: The previous way of splitting basePrompt and prepending was likely causing syntax issues.
    // This approach directly includes toolInfoForPrompt at the start of each relevant prompt branch.

    try {
      // Initialize toolset inside the request handler with the API key
      const toolset = new VercelAIToolSet({ apiKey: composioApiKey }); // Pass apiKey here
      
      // Only load tools if any were mentioned
      let output;
      
      if (mentionedToolIds.length > 0) {
        // Load tools and include them in the API call
        const tools = await toolset.getTools({ apps: appsToLoad });
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

      if (mode === 'ask') {
        // For ask mode, just return the response as chat output
        return NextResponse.json({ 
          chatResponse: output.text,
          type: 'chat'
        });
      } else {
        // For agent mode, handle document modifications
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