import fs from 'fs';
import path from 'path';
import * as TOML from '@iarna/toml';
import { minimatch } from 'minimatch';

export interface SyntaxPatternGroup {
  extensions: string[];
  include: string[];
  exclude?: string[];
}

export interface SimilarityConfig {
  threshold: number;
  limit: number;
  onExceed?: 'warn' | 'fail';
}

export interface LoggingConfig {
  level?: 'silent' | 'error' | 'warn' | 'info' | 'verbose' | 'debug';
}

export interface ScanConfig {
  server?: {
    url?: string;
  };
  logging?: LoggingConfig;
  scan?: {
    extensions?: string[];
    use_ignore_files?: string[];
    similarity?: SimilarityConfig;
    patterns?: SyntaxPatternGroup[];
  };
}

export const DEFAULT_CONFIG: ScanConfig = {
  server: {
    url: 'http://localhost:3000',
  },
  logging: {
    level: 'info',
  },
  scan: {
    use_ignore_files: ['.gitignore', '.dockerignore', '.dryignore'],
    similarity: {
      threshold: 0.8,
      limit: 10,
      onExceed: 'warn',
    },
    patterns: [
      {
        extensions: ['ts', 'tsx', 'js', 'jsx'],
        include: [
          'function\\s+(\\w+)\\s*\\(',
          'const\\s+(\\w+)\\s*=\\s*\\([^)]*\\)\\s*=>',
          '(\\w+):\\s*function\\s*\\(',
          'if\\s*\\([^)]*\\)\\s*{',
          'for\\s*\\([^)]*\\)\\s*{',
        ],
      },
    ],
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
    return parsed;
  } catch (error: any) {
    throw new Error(`Failed to load/parse config from ${configPath}: ${error.message}`);
  }
}

/**
 * Resolves the final configuration by merging defaults, config file, and CLI options.
 */
export function resolveConfig(scanPath: string, cliOptions: any): ScanConfig {
  const configPath = findConfigFile(path.resolve(scanPath));
  let config: ScanConfig = {};
  if (configPath) {
    config = loadConfig(configPath);
  }

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
  if (cliOptions.onExceed) {
    if (!config.scan) config.scan = {};
    if (!config.scan.similarity) config.scan.similarity = { threshold: 0.8, limit: 10 };
    config.scan.similarity.onExceed = cliOptions.onExceed;
  }

  // Handle logging CLI options
  if (cliOptions.verbose) {
    config.logging = { ...config.logging, level: 'verbose' };
  } else if (cliOptions.quiet) {
    config.logging = { ...config.logging, level: 'warn' };
  } else if (cliOptions.debug) {
    config.logging = { ...config.logging, level: 'debug' };
  } else if (cliOptions.silent) {
    config.logging = { ...config.logging, level: 'silent' };
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
  useIgnoreFiles: string[] = ['.gitignore', '.dockerignore', '.dryignore']
): string[] {
  const extensions = new Set<string>();
  const rootPath = path.resolve(dirPath);
  
  const allIgnorePatterns = loadIgnoreFiles(rootPath, useIgnoreFiles);

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
  const supportedExtensions = (DEFAULT_CONFIG.scan?.patterns || []).flatMap(p => p.extensions);
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
      return `[${value.map(v => formatTomlValue(v)).join(', ')}]`;
    }
    // Multi-line array
    return `[\n${value.map(v => `  ${formatTomlValue(v)}`).join(',\n')}\n]`;
  }
  if (typeof value === 'string') {
    // Use single quotes (literal strings) for strings that don't contain single quotes.
    // This is much safer for regex as it doesn't require backslash escaping.
    if (!value.includes("'")) {
      return `'${value}'`;
    }
    // Fallback to double quotes and escape backslashes and double quotes if single quotes are present
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
      use_ignore_files: ['.gitignore', '.dockerignore', '.dryignore'],
      similarity: DEFAULT_CONFIG.scan?.similarity,
      patterns: [],
    },
  };

  // Add pattern groups that match detected extensions
  if (config.scan && config.scan.patterns && DEFAULT_CONFIG.scan?.patterns) {
    const addedPatterns = new Set<SyntaxPatternGroup>();
    for (const ext of extensions) {
      const group = DEFAULT_CONFIG.scan.patterns.find(p => p.extensions.includes(ext));
      if (group && !addedPatterns.has(group)) {
        config.scan.patterns.push(group);
        addedPatterns.add(group);
      }
    }
  }

  // Manually format TOML to ensure proper formatting
  const lines: string[] = [];
  
  // Server section
  lines.push('[server]');
  if (config.server?.url) {
    lines.push(`url = ${formatTomlValue(config.server.url)}`);
  }
  lines.push('');
  
  // Scan section
  lines.push('[scan]');
  if (config.scan?.extensions) {
    lines.push(`extensions = ${formatTomlValue(config.scan.extensions)}`);
  }
  if (config.scan?.use_ignore_files) {
    lines.push(`use_ignore_files = ${formatTomlValue(config.scan.use_ignore_files)}`);
  }
  lines.push('');

  // Logging section
  if (config.logging?.level) {
    lines.push('[logging]');
    lines.push(`level = ${formatTomlValue(config.logging.level)}`);
    lines.push('');
  }
  
  // Similarity section
  if (config.scan?.similarity) {
    lines.push('[scan.similarity]');
    lines.push(`threshold = ${config.scan.similarity.threshold}`);
    lines.push(`limit = ${config.scan.similarity.limit}`);
    if (config.scan.similarity.onExceed) {
      lines.push(`onExceed = ${formatTomlValue(config.scan.similarity.onExceed)}`);
    }
    lines.push('');
  }
  
  // Patterns section
  if (config.scan?.patterns && config.scan.patterns.length > 0) {
    lines.push('[[scan.patterns]]');
    for (let i = 0; i < config.scan.patterns.length; i++) {
      const group = config.scan.patterns[i];
      if (i > 0) lines.push('[[scan.patterns]]');
      lines.push(`extensions = ${formatTomlValue(group.extensions)}`);
      lines.push(`include = ${formatTomlValue(group.include, true)}`);
      if (group.exclude && group.exclude.length > 0) {
        lines.push(`exclude = ${formatTomlValue(group.exclude, true)}`);
      }
      lines.push('');
    }
  }
  
  const content = lines.join('\n');
  fs.writeFileSync(configPath, content, 'utf-8');
}
