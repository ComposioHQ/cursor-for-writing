'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Layout from './components/Layout';
import { Editor } from '@tiptap/react';
import { BlogPost } from './utils/fileOperations';

// Configure dynamic import with SSR disabled and loading state
const MarkdownEditor = dynamic(
  () => import('./components/MarkdownEditor'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-gray-500">Loading editor...</div>
      </div>
    )
  }
);

export default function Home() {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editorContent, setEditorContent] = useState<string>('');

  useEffect(() => {
    // Check if there's a saved document ID in localStorage
    const savedDocId = localStorage.getItem('lastOpenedDoc');
    if (savedDocId) {
      setSelectedDocId(savedDocId);
    }
    setIsLoading(false);
  }, []);

  const handleContentChange = (content: string) => {
    setEditorContent(content);
  };

  const handleDocumentSelect = (id: string | null) => {
    setSelectedDocId(id);
    if (id) {
      localStorage.setItem('lastOpenedDoc', id);
    } else {
      localStorage.removeItem('lastOpenedDoc');
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-black">Loading...</div>
      </div>
    );
  }

  return (
    <Layout 
      onDocumentSelect={handleDocumentSelect} 
      editor={editor}
      editorContent={editorContent}
    >
      <div className="h-full w-full bg-white">
        <MarkdownEditor 
          documentId={selectedDocId || undefined} 
          onEditorReady={setEditor}
          onContentChange={handleContentChange}
        />
      </div>
    </Layout>
  );
} 