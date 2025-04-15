# AI Writing Assistant Backend

This is a Next.js application providing backend API endpoints for various AI-powered writing features, including chat interactions, text autocompletion, and blog post management.

## Features

*   **/api/chat**: Handles chat interactions, allowing users to interact with an AI model. It supports different modes like agent-based document modification and conversational assistance. Integrates with Composio tools.
*   **/api/autocomplete**: Provides text autocompletion suggestions based on the current text and context, powered by an AI model.
*   **/api/blogs**: Manages blog posts, allowing fetching and saving posts (stored as JSON files locally).

## Tech Stack

*   [Next.js](https://nextjs.org/) - React framework for server-side rendering and API routes.
*   [TypeScript](https://www.typescriptlang.org/) - Typed superset of JavaScript.
*   [Vercel AI SDK](https://sdk.vercel.ai/) - For integrating AI models and features.
*   [OpenAI](https://openai.com/) / [Google AI](https://ai.google/) - Language models used for generation.
*   [Composio](https://composio.dev/) - For integrating third-party tools via Vercel AI SDK.
*   [dotenv](https://github.com/motdotla/dotenv) - For loading environment variables.

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <repository-directory>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Set up environment variables:**
    Create a `.env` file in the root directory and add the necessary API keys:
    ```env
    # Required for /api/chat and /api/autocomplete
    OPENAI_API_KEY=your_openai_api_key 
    # Optional alternative model for /api/chat and /api/autocomplete (uncomment if used)
    # GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key 

    # Required for Composio tool integration in /api/chat
    COMPOSIO_API_KEY=your_composio_api_key 
    NEXT_PUBLIC_LOCAL_ENV=False #Change to True for full functionality
    # Add any other keys used by Composio tools or other services
    # Example: GROQ_API_KEY, MISTRAL_API_KEY, SOLANA keys... 
    # (Only include if actively used by your Composio-integrated tools)

    ```
    *Replace `your_..._key` with your actual API keys.*

4.  **Run the development server:**
    ```bash
    npm run dev
    # or
    yarn dev
    ```
    The application will start, typically on `http://localhost:3000`.

## API Endpoints

*   `POST /api/chat`: Accepts JSON body with `message`, `currentContent` (optional), `selections` (optional), `mode` ('agent' or 'ask'), and `composioApiKey`. Returns AI-generated chat responses or document modifications.
*   `POST /api/autocomplete`: Accepts JSON body with `text`, `cursorPosition`, and `context` (optional). Returns AI-generated text completion suggestions.
*   `GET /api/blogs`: Fetches all blog posts stored in the `blogs/` directory.
*   `POST /api/blogs`: Saves a new blog post. Accepts JSON body representing the post structure. 