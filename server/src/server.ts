import express from 'express';
import crypto from 'crypto';
import { Config, ElementData } from './types';
import { EmbeddingService } from './embedding';
import { VectorDb } from './vector-db';
import { SimilarityService } from './similarity';

export class App {
  private app: express.Application;
  private embeddingService: EmbeddingService;
  private vectorDb: VectorDb;
  private similarityService: SimilarityService;

  constructor(private config: Config) {
    this.app = express();
    this.app.use(express.json());
    
    this.embeddingService = new EmbeddingService(config);
    this.vectorDb = new VectorDb(config);
    this.similarityService = new SimilarityService(this.vectorDb);

    this.setupRoutes();
  }

  private setupRoutes() {
    /**
     * POST /elements
     * Accepts ElementData, creates an embedding, stores it in Valkey, and returns a unique ID.
     */
    this.app.post('/elements', async (req, res) => {
      try {
        const elementData: ElementData = req.body;
        
        if (!elementData.elementString) {
          return res.status(400).json({ error: 'elementString is required' });
        }

        // Create embedding via external API
        const embedding = await this.embeddingService.createEmbedding(elementData.elementString);
        
        // Generate a unique ID for this element instance
        const id = crypto.randomUUID();

        // Store in Valkey
        await this.vectorDb.storeEmbedding({
          id,
          elementData,
          embedding,
        });

        res.json({ id });
      } catch (error: any) {
        console.error('Error processing element:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * DELETE /elements
     * Deletes all stored elements and embeddings.
     */
    this.app.delete('/elements', async (req, res) => {
      try {
        const count = await this.vectorDb.deleteAllEmbeddings();
        res.json({ success: true, deletedCount: count });
      } catch (error: any) {
        console.error('Error deleting elements:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * GET /similar/all
     * Finds the most similar elements across all elements.
     * This route must be defined before /similar/:id to avoid route conflicts.
     */
    this.app.get('/similar/all', async (req, res) => {
      try {
        const threshold = parseFloat(req.query.threshold as string) || 0.8;
        const limit = parseInt(req.query.limit as string) || 10;

        const pairs = await this.similarityService.findMostSimilarPairs(threshold, limit);
        
        res.json({ pairs });
      } catch (error: any) {
        console.error('Error finding most similar pairs:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * GET /similar/:id
     * Finds elements similar to the one with the given ID.
     */
    this.app.get('/similar/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const threshold = parseFloat(req.query.threshold as string) || 0.8;
        const limit = parseInt(req.query.limit as string) || 10;

        const similarElements = await this.similarityService.findSimilar(id, threshold, limit);
        
        res.json({ similarElements });
      } catch (error: any) {
        console.error('Error finding similar elements:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * GET /search
     * Semantic search for code elements.
     */
    this.app.get('/search', async (req, res) => {
      try {
        const query = req.query.q as string;
        if (!query) {
          return res.status(400).json({ error: 'Query parameter q is required' });
        }

        const threshold = parseFloat(req.query.threshold as string) || 0.8;
        const limit = parseInt(req.query.limit as string) || 10;

        const embedding = await this.embeddingService.createEmbedding(query);
        const results = await this.similarityService.searchByVector(embedding, threshold, limit);
        
        res.json({ results });
      } catch (error: any) {
        console.error('Error during semantic search:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * GET /health
     * Basic health check endpoint.
     */
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  public start() {
    this.app.listen(this.config.port, '0.0.0.0', () => {
      console.log(`DRY Server listening on port ${this.config.port}`);
      console.log(`Embedding API URL: ${this.config.embeddingApiUrl}`);
      console.log(`Valkey URL: ${this.config.valkeyUrl}`);
    });
  }
}

