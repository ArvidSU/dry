import express, { Request, Response } from 'express';
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
    this.app.use(express.json({ limit: '10mb' }));
    
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
    this.app.post('/elements', async (req: Request, res: Response) => {
      try {
        const elementData: ElementData = req.body;
        
        if (!elementData.elementString) {
          return res.status(400).json({ error: 'elementString is required' });
        }

        let embedding: number[] | null = null;
        const { fileHash, elementName, lineNumber } = elementData.metadata;

        // Try to get from cache if fileHash is provided
        if (fileHash) {
          embedding = await this.vectorDb.getCachedEmbedding(fileHash, elementName, lineNumber);
          if (embedding) {
            console.log(`Cache hit for ${elementName} in ${elementData.metadata.filePath}`);
          }
        }

        if (!embedding) {
          // Create embedding via external API
          embedding = await this.embeddingService.createEmbedding(elementData.elementString);
          
          // Store in cache if fileHash is provided
          if (fileHash) {
            await this.vectorDb.cacheEmbedding(fileHash, elementName, lineNumber, embedding);
          }
        }
        
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
     * POST /elements/batch
     * Accepts an array of ElementData, creates embeddings in parallel, 
     * and stores them in Valkey using a pipeline.
     */
    this.app.post('/elements/batch', async (req: Request, res: Response) => {
      try {
        const batch: ElementData[] = req.body;
        
        if (!Array.isArray(batch)) {
          return res.status(400).json({ error: 'Body must be an array of element data' });
        }

        if (batch.length === 0) {
          return res.json({ ids: [] });
        }

        // Check cache for each element in the batch
        const embeddings = new Array<number[]>(batch.length);
        const cacheKeys = batch.map(e => ({
          fileHash: e.metadata.fileHash || '',
          elementName: e.metadata.elementName,
          lineNumber: e.metadata.lineNumber
        }));

        const cachedResults = await this.vectorDb.getBatchCachedEmbeddings(cacheKeys.filter(k => k.fileHash !== ''));
        
        const indicesToFetch: number[] = [];
        let cachedCount = 0;

        let cacheResultIdx = 0;
        for (let i = 0; i < batch.length; i++) {
          if (batch[i].metadata.fileHash) {
            const cached = cachedResults[cacheResultIdx++];
            if (cached) {
              embeddings[i] = cached;
              cachedCount++;
              continue;
            }
          }
          indicesToFetch.push(i);
        }

        if (indicesToFetch.length > 0) {
          console.log(`Cache: ${cachedCount} hits, ${indicesToFetch.length} misses in batch of ${batch.length}. Fetching embeddings...`);
          const stringsToFetch = indicesToFetch.map(i => batch[i].elementString);
          const fetchedEmbeddings = await this.embeddingService.createEmbeddings(stringsToFetch);

          const cacheEntries: { fileHash: string, elementName: string, lineNumber: number, embedding: number[] }[] = [];

          for (let i = 0; i < indicesToFetch.length; i++) {
            const batchIndex = indicesToFetch[i];
            const embedding = fetchedEmbeddings[i];
            embeddings[batchIndex] = embedding;

            // Store in cache if fileHash is provided
            const elementData = batch[batchIndex];
            const { fileHash, elementName, lineNumber } = elementData.metadata;
            if (fileHash) {
              cacheEntries.push({ fileHash, elementName, lineNumber, embedding });
            }
          }

          if (cacheEntries.length > 0) {
            await this.vectorDb.cacheEmbeddings(cacheEntries);
          }
        } else {
          console.log(`All ${batch.length} elements in batch found in cache.`);
        }
        
        const indices = batch.map((elementData, i) => ({
          id: crypto.randomUUID(),
          elementData,
          embedding: embeddings[i],
        }));

        // Store in Valkey using pipeline
        await this.vectorDb.storeEmbeddings(indices);

        res.json({ ids: indices.map(idx => idx.id) });
      } catch (error: any) {
        console.error('Error processing batch:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
      }
    });

    /**
     * DELETE /elements
     * Deletes all stored elements and embeddings.
     */
    this.app.delete('/elements', async (req: Request, res: Response) => {
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
    this.app.get('/similar/all', async (req: Request, res: Response) => {
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
    this.app.get('/similar/:id', async (req: Request, res: Response) => {
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
    this.app.get('/search', async (req: Request, res: Response) => {
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
    this.app.get('/health', (req: Request, res: Response) => {
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

