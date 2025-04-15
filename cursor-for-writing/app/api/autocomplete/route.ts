import { NextResponse } from 'next/server';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google'
import { generateText } from 'ai';

const aiConfig = {
  model: openai('gpt-4o'),
  temperature: 0.3, // Lower temperature for more focused completions
  maxTokens: 300, // Shorter responses for quick suggestions
};

export async function POST(request: Request) {
  try {
    const { text, cursorPosition, context } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const prompt = `
Given the following text and cursor position, suggest a completion that would make sense in the context.
Current text up to cursor: "${text}"
Context: ${context || 'None provided'}

Provide a natural completion that would fit well here. Keep it concise and relevant.
Return ONLY the completion text, no explanations or formatting, and **do not** wrap it in quotation marks.`;

    try {
      const completion = await generateText({
        ...aiConfig,
        prompt,
      });

      return NextResponse.json({ 
        completion: completion.text.trim(),
      });
    } catch (aiError) {
      console.error('AI Generation Error:', aiError);
      return NextResponse.json({ 
        error: 'Failed to generate completion',
        details: aiError instanceof Error ? aiError.message : 'Unknown error'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in autocomplete API:', error);
    return NextResponse.json({
      error: 'Failed to process autocomplete request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 