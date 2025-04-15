'use server';

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { BLOG_DIR } from '../../config/paths';
import dotenv from 'dotenv';

dotenv.config();

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);

// Read the environment variable at the module level
const isLocalEnv = process.env.NEXT_PUBLIC_LOCAL_ENV === 'True';

// Ensure blogs directory exists only if in local env
if (isLocalEnv && !fs.existsSync(BLOG_DIR)) {
  fs.mkdirSync(BLOG_DIR, { recursive: true });
}

export async function GET() {
  // Only allow GET if in local env
  if (!isLocalEnv) {
    console.log('GET /api/blogs blocked: Not in local environment.');
    return NextResponse.json([]); // Return empty array if not local
  }
  try {
    // Check if directory exists before reading (it might not if isLocalEnv was false initially)
    if (!fs.existsSync(BLOG_DIR)) {
        return NextResponse.json([]);
    }
    const files = await readdirAsync(BLOG_DIR);
    const posts = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(BLOG_DIR, file);
        const content = await readFileAsync(filePath, 'utf-8');
        posts.push(JSON.parse(content));
      }
    }

    posts.sort((a, b) => 
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    );

    return NextResponse.json(posts);
  } catch (error) {
    console.error('Error fetching blogs:', error);
    return NextResponse.json({ error: 'Failed to fetch blogs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const post = await request.json();
    
    // Only attempt to write if in local environment
    if (isLocalEnv) {
      // Ensure the directory exists before writing (needed if created conditionally)
       if (!fs.existsSync(BLOG_DIR)) {
         fs.mkdirSync(BLOG_DIR, { recursive: true });
       }
      const filePath = path.join(BLOG_DIR, `${post.id}.json`);
      await writeFileAsync(filePath, JSON.stringify(post, null, 2));
      console.log(`Blog post saved locally: ${post.id}.json`);
    } else {
      console.log(`Skipping file write for blog post ${post.id}: Not in local environment.`);
      // Optionally add a slight delay to simulate network/write time if needed
      // await new Promise(resolve => setTimeout(resolve, 50)); 
    }
    
    // Always return the post data as if successful
    return NextResponse.json(post);
  } catch (error) {
    console.error('Error saving blog:', error);
    // Still return error if something else goes wrong (like request parsing)
    return NextResponse.json({ error: 'Failed to save blog' }, { status: 500 });
  }
} 