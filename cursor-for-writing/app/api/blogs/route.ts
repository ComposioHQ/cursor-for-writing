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

// Ensure blogs directory exists
if (!fs.existsSync(BLOG_DIR)) {
  fs.mkdirSync(BLOG_DIR, { recursive: true });
}

export async function GET() {
  try {
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
    const filePath = path.join(BLOG_DIR, `${post.id}.json`);
    await writeFileAsync(filePath, JSON.stringify(post, null, 2));
    return NextResponse.json(post);
  } catch (error) {
    console.error('Error saving blog:', error);
    return NextResponse.json({ error: 'Failed to save blog' }, { status: 500 });
  }
} 