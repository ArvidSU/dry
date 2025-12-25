import fs from 'fs';
import path from 'path';
import * as TOML from '@iarna/toml';
import { minimatch } from 'minimatch';

export interface LanguageConfig {
  [extension: string]: string[];
}

export interface SimilarityConfig {
  threshold: number;
  limit: number;
}

export interface ScanConfig {
  server?: {
    url?: string;
  };
  scan?: {
    extensions?: string[];
    ignore?: string[];
    use_ignore_files?: string[];
    similarity?: SimilarityConfig;
    languages?: LanguageConfig;
  };
}

export const DEFAULT_CONFIG: ScanConfig = {
  server: {
    url: 'http://localhost:3000',
  },
  scan: {
    extensions: ['ts', 'tsx', 'js', 'jsx'],
    ignore: ['node_modules/', '.git/', 'dist/', 'build/'],
    similarity: {
      threshold: 0.8,
      limit: 10,
    },
    languages: {
      ts: ['\\bfunction\\s+(\\w+)\\s*\\(', '\\bconst\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>', '\\b(\\w+)\\s*:\\s*function\\s*\\('],
      tsx: ['\\bfunction\\s+(\\w+)\\s*\\(', '\\bconst\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>', '\\b(\\w+)\\s*:\\s*function\\s*\\('],
      js: ['\\bfunction\\s+(\\w+)\\s*\\(', '\\bconst\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>', '\\b(\\w+)\\s*:\\s*function\\s*\\('],
      jsx: ['\\bfunction\\s+(\\w+)\\s*\\(', '\\bconst\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>', '\\b(\\w+)\\s*:\\s*function\\s*\\('],
    },
  },
};

/**
 * Finds the nearest dry-scan.toml by walking up from the startPath.
 */
export function findConfigFile(startPath: string): string | null {
  let currentDir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  
  while (true) {
    const configPath = path.join(currentDir, 'dry-scan.toml');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  
  return null;
}

/**
 * Loads and parses the configuration file.
 */
export function loadConfig(configPath: string): ScanConfig {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = TOML.parse(content) as unknown as ScanConfig;
    return mergeConfigs(DEFAULT_CONFIG, parsed);
  } catch (error: any) {
    console.warn(`Warning: Failed to load config from ${configPath}: ${error.message}`);
    return DEFAULT_CONFIG;
  }
}

/**
 * Merges two configurations, with the second one taking priority.
 * This is a shallow merge for top level and one level deep for scan and server.
 */
function mergeConfigs(base: ScanConfig, override: ScanConfig): ScanConfig {
  return {
    server: {
      ...base.server,
      ...override.server,
    },
    scan: {
      ...base.scan,
      ...override.scan,
      similarity: {
        ...base.scan?.similarity,
        ...override.scan?.similarity,
      } as SimilarityConfig,
      languages: {
        ...base.scan?.languages,
        ...override.scan?.languages,
      } as LanguageConfig,
    },
  };
}

/**
 * Resolves the final configuration by merging defaults, config file, and CLI options.
 */
export function resolveConfig(scanPath: string, cliOptions: any): ScanConfig {
  const configPath = findConfigFile(path.resolve(scanPath));
  let config = configPath ? loadConfig(configPath) : DEFAULT_CONFIG;

  // Merge CLI options (CLI overrides config)
  if (cliOptions.url) {
    config.server = { ...config.server, url: cliOptions.url };
  }
  if (cliOptions.extensions) {
    config.scan = { ...config.scan, extensions: cliOptions.extensions.split(',').map((e: string) => e.trim()) };
  }
  if (cliOptions.threshold) {
    if (!config.scan) config.scan = {};
    if (!config.scan.similarity) config.scan.similarity = { threshold: 0.8, limit: 10 };
    config.scan.similarity.threshold = parseFloat(cliOptions.threshold);
  }
  if (cliOptions.limit) {
    if (!config.scan) config.scan = {};
    if (!config.scan.similarity) config.scan.similarity = { threshold: 0.8, limit: 10 };
    config.scan.similarity.limit = parseInt(cliOptions.limit);
  }

  return config;
}

/**
 * Loads ignore patterns from specified ignore files (e.g., .gitignore, .dockerignore).
 */
export function loadIgnoreFiles(rootPath: string, ignoreFiles: string[]): string[] {
  const patterns: string[] = [];
  
  for (const ignoreFile of ignoreFiles) {
    const filePath = path.resolve(rootPath, ignoreFile);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        for (let line of lines) {
          line = line.trim();
          if (line && !line.startsWith('#')) {
            patterns.push(line);
          }
        }
      } catch (error: any) {
        console.warn(`Warning: Failed to read ignore file ${filePath}: ${error.message}`);
      }
    }
  }
  
  return patterns;
}

/**
 * Recursively detects file extensions in a directory, respecting ignore patterns.
 */
export function detectExtensions(
  dirPath: string, 
  ignorePatterns: string[] = ['node_modules/', '.git/', 'dist/', 'build/'],
  useIgnoreFiles: string[] = []
): string[] {
  const extensions = new Set<string>();
  const rootPath = path.resolve(dirPath);
  
  const allIgnorePatterns = [...ignorePatterns];
  if (useIgnoreFiles.length > 0) {
    allIgnorePatterns.push(...loadIgnoreFiles(rootPath, useIgnoreFiles));
  }

  function walk(currentPath: string) {
    if (!fs.existsSync(currentPath)) return;
    const list = fs.readdirSync(currentPath);
    for (const file of list) {
      const fullPath = path.join(currentPath, file);
      const relativePath = path.relative(rootPath, fullPath);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        continue; // Skip files we can't access
      }

      const isIgnored = allIgnorePatterns.some(pattern => {
        // Handle directory patterns like "node_modules/" or ".svelte-kit/"
        if (pattern.endsWith('/')) {
          const dirPattern = pattern.slice(0, -1);
          // For directories: match the directory itself
          // For files: match if they're inside the directory (using ** glob)
          // This handles both "node_modules" and "**/node_modules/**" style patterns
          return minimatch(relativePath, dirPattern) || 
                 minimatch(relativePath, `${dirPattern}/**`) ||
                 minimatch(relativePath, `**/${dirPattern}/**`);
        }
        return minimatch(relativePath, pattern);
      });

      if (isIgnored) continue;
// ... (rest of walk)

      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(file).toLowerCase().slice(1);
        // Only collect extensions we actually support or common source extensions
        if (ext && ext.length < 5 && /^[a-z0-9]+$/.test(ext)) {
          extensions.add(ext);
        }
      }
    }
  }

  walk(rootPath);
  
  // Filter to keep only extensions that are either in our default config or likely source files
  const supportedExtensions = Object.keys(DEFAULT_CONFIG.scan?.languages || {});
  const detected = Array.from(extensions);
  
  // Prioritize supported ones, but allow others if they look like source code
  return detected
    .filter(ext => supportedExtensions.includes(ext) || ['py', 'go', 'rs', 'cpp', 'c', 'h', 'java', 'rb'].includes(ext))
    .sort();
}

/**
 * Formats a TOML value, handling strings, arrays, and nested objects.
 */
function formatTomlValue(value: any, forceMultiline: boolean = false): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    // For arrays of strings (like ignore patterns or regex patterns), always use multi-line
    // For short arrays of simple values, use inline format
    const allSimple = value.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    if (!forceMultiline && allSimple && value.length <= 2 && value.every(v => typeof v !== 'string' || v.length < 10)) {
      return `[${value.map(v => typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v).join(', ')}]`;
    }
    // Multi-line array
    return `[\n${value.map(v => `  ${typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v}`).join(',\n')}\n]`;
  }
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return String(value);
}

/**
 * Creates a default dry-scan.toml file with detected extensions.
 */
export function createConfigFile(configPath: string, extensions: string[]) {
  const config: ScanConfig = {
    server: {
      url: 'http://localhost:3000',
    },
    scan: {
      extensions: extensions.length > 0 ? extensions : DEFAULT_CONFIG.scan?.extensions,
      ignore: DEFAULT_CONFIG.scan?.ignore,
      use_ignore_files: ['.gitignore', '.dockerignore'],
      similarity: DEFAULT_CONFIG.scan?.similarity,
      languages: {},
    },
  };

  // Add language mappings for detected extensions if we have defaults for them
  if (config.scan && config.scan.languages) {
    for (const ext of extensions) {
      if (DEFAULT_CONFIG.scan?.languages?.[ext]) {
        config.scan.languages[ext] = DEFAULT_CONFIG.scan.languages[ext];
      }
    }
  }

  // Manually format TOML to ensure proper formatting
  const lines: string[] = [];
  
  // Server section
  lines.push('[server]');
  if (config.server?.url) {
    lines.push(`url = "${config.server.url}"`);
  }
  lines.push('');
  
  // Scan section
  lines.push('[scan]');
  if (config.scan?.extensions) {
    lines.push(`extensions = ${formatTomlValue(config.scan.extensions)}`);
  }
  if (config.scan?.ignore) {
    lines.push(`ignore = ${formatTomlValue(config.scan.ignore, true)}`);
  }
  if (config.scan?.use_ignore_files) {
    lines.push(`use_ignore_files = ${formatTomlValue(config.scan.use_ignore_files)}`);
  }
  lines.push('');
  
  // Similarity section
  if (config.scan?.similarity) {
    lines.push('[scan.similarity]');
    lines.push(`threshold = ${config.scan.similarity.threshold}`);
    lines.push(`limit = ${config.scan.similarity.limit}`);
    lines.push('');
  }
  
  // Languages section
  if (config.scan?.languages && Object.keys(config.scan.languages).length > 0) {
    lines.push('[scan.languages]');
    for (const [ext, patterns] of Object.entries(config.scan.languages)) {
      lines.push(`${ext} = ${formatTomlValue(patterns, true)}`);
    }
  }
  
  const content = lines.join('\n');
  fs.writeFileSync(configPath, content, 'utf-8');
}

