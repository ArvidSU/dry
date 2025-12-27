import dotenv from 'dotenv';
import { App } from './server';
import { Config } from './types';

// Load environment variables
dotenv.config();

// Helper to construct the embedding URL
// Compose-injected EMBEDDINGGEMMA_URL is the base URL, so we need to append /embeddings
function getEmbeddingApiUrl(): string {
  if (process.env.EMBEDDING_API_URL) {
    return process.env.EMBEDDING_API_URL;
  }
  
  if (process.env.EMBEDDINGGEMMA_URL) {
    // Compose-injected URL is the base URL, append /embeddings for OpenAI-compatible endpoint
    const baseUrl = process.env.EMBEDDINGGEMMA_URL.replace(/\/$/, ''); // Remove trailing slash if present
    return `${baseUrl}/embeddings`;
  }
  
  return 'http://embeddinggemma:8080/v1/embeddings';
}

// Debug: Log which environment variables are set (for troubleshooting)
const embeddingUrl = getEmbeddingApiUrl();
if (process.env.EMBEDDING_API_URL) {
  console.log('Using EMBEDDING_API_URL:', embeddingUrl);
} else if (process.env.EMBEDDINGGEMMA_URL) {
  console.log('Using EMBEDDINGGEMMA_URL (Compose-injected):', process.env.EMBEDDINGGEMMA_URL);
  console.log('Constructed embedding endpoint:', embeddingUrl);
} else {
  console.log('Using default embedding URL (no env vars set)');
}

const config: Config = {
  embeddingApiUrl: embeddingUrl,
  embeddingApiKey: process.env.EMBEDDING_API_KEY || '',
  embeddingChunkSize: parseInt(process.env.EMBEDDING_CHUNK_SIZE || '1000', 10),
  valkeyUrl: process.env.VALKEY_URL || 'redis://localhost:6379',
  port: parseInt(process.env.PORT || '3000', 10),
};

// Start the application
const app = new App(config);
app.start();

