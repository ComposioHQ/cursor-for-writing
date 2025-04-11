export interface BlogPost {
  id: string;
  title: string;
  content: string;
  description?: string;
  status: 'Draft' | 'Published';
  lastModified: Date;
}

export const saveBlogPost = async (post: BlogPost): Promise<BlogPost> => {
  const response = await fetch('/api/blogs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(post),
  });

  if (!response.ok) {
    throw new Error('Failed to save blog post');
  }

  return response.json();
};

export const loadBlogPost = async (id: string): Promise<BlogPost | null> => {
  const posts = await getAllBlogPosts();
  return posts.find(post => post.id === id) || null;
};

export const getAllBlogPosts = async (): Promise<BlogPost[]> => {
  const response = await fetch('/api/blogs');
  
  if (!response.ok) {
    throw new Error('Failed to fetch blog posts');
  }

  return response.json();
}; 