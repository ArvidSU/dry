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

export interface EmbeddingIndex {
  id: string;
  elementData: ElementData;
  embedding: number[];
}

export interface SubmitElementResponse {
  id: string;
}

export interface SubmitBatchResponse {
  ids: string[];
}

export interface SimilarElementsResponse {
  similarElements: ElementData[];
}

export interface SimilarPair {
  element1: ElementData;
  element2: ElementData;
  similarity: number;
}

export interface SimilarPairsResponse {
  pairs: SimilarPair[];
}

export interface SearchResult {
  element: ElementData;
  similarity: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

