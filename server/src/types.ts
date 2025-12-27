export interface ElementMetadata {
  filePath: string;
  lineNumber: number;
  elementName: string;
  commitHash?: string;
  fileHash?: string;
  basePath?: string;
}

export interface ElementData {
  metadata: ElementMetadata;
  elementString: string;
}

export interface SubmitBatchResponse {
  ids: string[];
}

export interface EmbeddingIndex {
  id: string;
  elementData: ElementData;
  embedding: number[];
}

export interface Config {
  embeddingApiUrl: string;
  embeddingApiKey: string;
  embeddingChunkSize: number;
  valkeyUrl: string;
  port: number;
}

export interface SearchResult {
  element: ElementData;
  similarity: number;
}

