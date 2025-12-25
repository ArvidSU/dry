export interface ElementMetadata {
  filePath: string;
  lineNumber: number;
  elementName: string;
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

export interface Config {
  embeddingApiUrl: string;
  embeddingApiKey: string;
  valkeyUrl: string;
  port: number;
}

