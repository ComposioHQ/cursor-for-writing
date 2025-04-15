const STORAGE_KEY = 'blogPosts';

// Helper function to get all posts from localStorage
const getPostsFromStorage = (): BlogPost[] => {
  try {
    const storedPosts = localStorage.getItem(STORAGE_KEY);
    if (storedPosts) {
      // Parse and convert date strings back to Date objects
      return JSON.parse(storedPosts).map((post: any) => ({
        ...post,
        lastModified: new Date(post.lastModified), // Convert string back to Date
      }));
    }
  } catch (error) {
    console.error('Error reading posts from localStorage:', error);
    // Optional: Clear corrupted data
    // localStorage.removeItem(STORAGE_KEY); 
  }
  return []; // Return empty array if no posts or error
};

// Helper function to save all posts to localStorage
const savePostsToStorage = (posts: BlogPost[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  } catch (error) {
    console.error('Error saving posts to localStorage:', error);
    // Handle potential storage limits or other errors
  }
};

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  description?: string;
  status: 'Draft' | 'Published';
  lastModified: Date;
}

export const saveBlogPost = async (post: BlogPost): Promise<BlogPost> => {
  return new Promise((resolve) => {
    const posts = getPostsFromStorage();
    const existingIndex = posts.findIndex(p => p.id === post.id);
    
    // Ensure lastModified is a Date object before saving
    const postToSave = {
        ...post,
        lastModified: new Date(post.lastModified), // Ensure it's a Date object
    };

    if (existingIndex > -1) {
      // Update existing post
      posts[existingIndex] = postToSave;
    } else {
      // Add new post
      posts.push(postToSave);
    }
    savePostsToStorage(posts);
    resolve(postToSave); // Resolve with the saved post
  });
};

export const loadBlogPost = async (id: string): Promise<BlogPost | null> => {
   return new Promise((resolve) => {
    const posts = getPostsFromStorage();
    const post = posts.find(p => p.id === id) || null;
    resolve(post);
  });
};

export const getAllBlogPosts = async (): Promise<BlogPost[]> => {
  return new Promise((resolve) => {
     const posts = getPostsFromStorage();
     // Sort by lastModified date, newest first
     posts.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
     resolve(posts);
  });
};

// --- Optional: Add a function to delete a blog post ---
export const deleteBlogPost = async (id: string): Promise<void> => {
  return new Promise((resolve) => {
    let posts = getPostsFromStorage();
    posts = posts.filter(p => p.id !== id);
    savePostsToStorage(posts);
    resolve();
  });
} 