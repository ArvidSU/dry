#!/usr/bin/env node
import { Command } from 'commander';
import { extractElements } from './extract';
import { DryClient } from './client';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { resolveConfig, findConfigFile, detectExtensions, createConfigFile, loadIgnoreFiles, ScanConfig } from './config';
import { getCommitHash } from './git';
import { minimatch } from 'minimatch';
import readline from 'readline';
import { logger, LogLevel } from './logger';

const program = new Command();

/**
 * Maps string log level to LogLevel enum.
 */
function mapLogLevel(level: string | undefined): LogLevel {
  switch (level?.toLowerCase()) {
    case 'silent': return LogLevel.SILENT;
    case 'error': return LogLevel.ERROR;
    case 'warn': return LogLevel.WARN;
    case 'info': return LogLevel.INFO;
    case 'verbose': return LogLevel.VERBOSE;
    case 'debug': return LogLevel.DEBUG;
    default: return LogLevel.INFO;
  }
}

/**
 * Initializes the logger based on configuration and CLI options.
 */
function initLogger(config: ScanConfig) {
  const level = mapLogLevel(config.logging?.level);
  logger.setLevel(level);
}

/**
 * Helper to ask a yes/no question in the terminal.
 */
async function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Handles the case where the number of similar matches exceeds the configured limit.
 */
function handleExceed(count: number, limit: number, action: 'warn' | 'fail' = 'warn') {
  if (count > limit) {
    logger.warn(`Found ${count} similar matches, which exceeds the limit of ${limit}.`);
    if (action === 'fail') {
      logger.error('You MUST ensure that the limit and threshold are NOT exceeded for this to pass. Do NOT change the configuration, just fix the code.');
      process.exit(1);
    }
  }
}

program
  .name('dry')
  .description('Extract elements and find similar code using embeddings')
  .version('0.1.0')
  .option('-v, --verbose', 'Show verbose output')
  .option('-q, --quiet', 'Show only warnings and errors')
  .option('--silent', 'Show no output')
  .option('--debug', 'Show debug output');

program
  .command('scan')
  .description('Scan a file or directory for elements and index them')
  .option('-p, --path <path>', 'File or directory to scan', '.')
  .option('-r, --regex <regex>', 'Regex to match element signatures (overrides config)')
  .option('--init', 'Initialize a new dry-scan.toml file')
  .option('--no-wipe', 'Do not wipe previous scans before indexing')
  .action(async (options) => {
    try {
      const resolvedPath = path.resolve(options.path);
      let configPath = findConfigFile(resolvedPath);

      // We need to resolve config early to initialize logger
      const tempConfig = resolveConfig(resolvedPath, { ...program.opts(), ...options });
      initLogger(tempConfig);

      // If --init is provided, we want to create a config file in the target directory
      // even if one already exists in a parent directory.
      if (options.init) {
        const targetConfigPath = path.join(resolvedPath, 'dry-scan.toml');
        if (fs.existsSync(targetConfigPath)) {
          logger.info(`Config file already exists at ${targetConfigPath}`);
          configPath = targetConfigPath;
        } else if (fs.statSync(resolvedPath).isDirectory()) {
          const detected = detectExtensions(resolvedPath);
          if (detected.length > 0) {
            logger.info(`Detected potential source extensions: ${detected.join(', ')}`);
            createConfigFile(targetConfigPath, detected);
            logger.success(`Created ${targetConfigPath}`);
            configPath = targetConfigPath;
          } else {
            logger.info('No source extensions detected. Creating a default config.');
            createConfigFile(targetConfigPath, ['ts', 'js']);
            logger.success(`Created ${targetConfigPath}`);
            configPath = targetConfigPath;
          }
        }
      } else if (!configPath && fs.statSync(resolvedPath).isDirectory()) {
        const detected = detectExtensions(resolvedPath);
        if (detected.length > 0) {
          const message = `No dry-scan.toml found. Detected potential source extensions: ${detected.join(', ')}`;
          logger.info(message);
          const shouldCreate = await askYesNo('Would you like to create a dry-scan.toml with these extensions?');
          if (shouldCreate) {
            configPath = path.join(resolvedPath, 'dry-scan.toml');
            createConfigFile(configPath, detected);
            logger.success(`Created ${configPath}`);
          }
        }
      }

      const config = resolveConfig(resolvedPath, { ...program.opts(), ...options });
      // Re-init logger with final config
      initLogger(config);
      
      const commitHash = getCommitHash(resolvedPath);
      if (commitHash) {
        logger.debug(`Detected git commit: ${commitHash}`);
      }
      
      const serverUrl = config.server?.url || 'http://localhost:3000';
      const patterns = config.scan?.patterns || [];
      const extensions = config.scan?.extensions || Array.from(new Set(patterns.flatMap(p => p.extensions)));
      const useIgnoreFiles = config.scan?.use_ignore_files || ['.gitignore', '.dockerignore', '.dryignore'];

      const rootPathForIgnore = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
      const ignorePatterns = loadIgnoreFiles(rootPathForIgnore, useIgnoreFiles);
      
      const client = new DryClient(serverUrl);

      logger.info(`Using server: ${serverUrl}`);
      if (options.wipe !== false) {
        logger.info('Wiping previous scans...');
        const deletedCount = await client.wipeAllElements();
        logger.info(`Deleted ${deletedCount} elements from previous scans.`);
      } else {
        logger.info('Skipping wipe (incremental scan).');
      }

      let filesToScan: string[] = [];
      let subScans: string[] = [];
      const stats = fs.statSync(resolvedPath);

      if (stats.isFile()) {
        filesToScan = [resolvedPath];
      } else if (stats.isDirectory()) {
        logger.verbose(`Searching for files in ${resolvedPath} with extensions: ${extensions.join(', ')}...`);
        const result = getAllFiles(resolvedPath, extensions, ignorePatterns, resolvedPath);
        filesToScan = result.files;
        subScans = result.subScans;
      } else {
        throw new Error('Provided path is neither a file nor a directory');
      }

      if (filesToScan.length === 0 && subScans.length === 0) {
        logger.info('No files or sub-scans found.');
        return;
      }

      if (filesToScan.length > 0) {
        logger.info(`Found ${filesToScan.length} files to scan in this directory.`);
        let totalElements = 0;

        for (const filePath of filesToScan) {
          logger.verbose(`Scanning ${path.relative(process.cwd(), filePath)}...`);
          
          const ext = path.extname(filePath).toLowerCase().slice(1);
          let includePatterns: RegExp[] = [];
          let excludePatterns: RegExp[] = [];
          let minLength = 20;
          
          if (options.regex) {
            includePatterns = [new RegExp(options.regex, 'g')];
          } else {
            const matchingGroup = patterns.find(p => p.extensions.includes(ext));
            if (matchingGroup) {
              includePatterns = matchingGroup.include.map(p => new RegExp(p, 'g'));
              if (matchingGroup.exclude) {
                excludePatterns = matchingGroup.exclude.map(p => new RegExp(p, 'g'));
              }
              if (matchingGroup.min_length) {
                minLength = matchingGroup.min_length;
              }
            } else {
              // Fallback to default regex if no language specific one is found
              includePatterns = [/\bfunction\s+(\w+)\s*\(/g];
            }
          }

          const elements = extractElements(filePath, includePatterns, excludePatterns, minLength, commitHash || undefined);
          
          if (elements.length === 0) continue;

          logger.verbose(`  Found ${elements.length} elements. Submitting...`);
          for (const element of elements) {
            try {
              const id = await client.submitElement(element);
              logger.debug(`  Indexed: ${element.metadata.elementName} (ID: ${id})`);
              totalElements++;
            } catch (error: any) {
              // TODO: Implement batching of elements to submit to the server.
              // This is temporarily silenced to avoid confusing the agent.
              // logger.error(`  Failed to index ${element.metadata.elementName}: ${error.message}`);
            }
          }
        }
        
        logger.success(`Done indexing current directory. Indexed ${totalElements} elements from ${filesToScan.length} files.`);
      }

      // Handle sub-scans
      if (subScans.length > 0) {
        logger.info(`Found ${subScans.length} directories with their own dry-scan.toml. Spawning sub-scans...`);
        for (const subPath of subScans) {
          logger.info(`\n--- Spawning sub-scan for ${path.relative(process.cwd(), subPath)} ---`);
          
          const args = ['scan', subPath, '--no-wipe'];
          
          // Only pass through flags that were explicitly provided by the user
          if (process.argv.includes('--regex') || process.argv.includes('-r')) {
            args.push('--regex', options.regex);
          }
          if (program.opts().verbose) args.push('--verbose');
          if (program.opts().quiet) args.push('--quiet');
          if (program.opts().silent) args.push('--silent');
          if (program.opts().debug) args.push('--debug');
          
          const result = spawnSync(process.argv[0], [process.argv[1], ...args], { stdio: 'inherit' });
          if (result.status !== 0) {
            logger.error(`Sub-scan for ${subPath} failed with exit code ${result.status}`);
            process.exit(result.status ?? 1);
          }
        }
      }
    } catch (error: any) {
      logger.error(`${error.message}`);
      process.exit(1);
    }
  });

/**
 * Recursively gets all files in a directory that match the given extensions and are not ignored.
 * If a directory contains its own dry-scan.toml, it's marked as a sub-scan and not recursed.
 */
function getAllFiles(dirPath: string, extensions: string[], ignorePatterns: string[], rootPath: string): { files: string[]; subScans: string[] } {
  let files: string[] = [];
  let subScans: string[] = [];
  const list = fs.readdirSync(dirPath);
  
  for (const file of list) {
    const fullPath = path.resolve(dirPath, file);
    const relativePath = path.relative(rootPath, fullPath);
    const stat = fs.statSync(fullPath);
    
    // Check if path matches any ignore pattern
    const isIgnored = ignorePatterns.some(pattern => {
      // Handle directory patterns like "node_modules/" or ".svelte-kit/"
      if (pattern.endsWith('/')) {
        const dirPattern = pattern.slice(0, -1);
        return minimatch(relativePath, dirPattern) || 
               minimatch(relativePath, `${dirPattern}/**`) ||
               minimatch(relativePath, `**/${dirPattern}/**`);
      }
      return minimatch(relativePath, pattern);
    });

    if (isIgnored) continue;

    if (stat && stat.isDirectory()) {
      // If the directory has its own dry-scan.toml, it's a separate scan
      if (fs.existsSync(path.join(fullPath, 'dry-scan.toml'))) {
        subScans.push(fullPath);
      } else {
        const nested = getAllFiles(fullPath, extensions, ignorePatterns, rootPath);
        files = files.concat(nested.files);
        subScans = subScans.concat(nested.subScans);
      }
    } else {
      const ext = path.extname(file).toLowerCase().slice(1);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return { files, subScans };
}

program
  .command('discover')
  .description('Discover file extensions in a directory and show excluded directories')
  .argument('[path]', 'Directory to scan (defaults to current directory)', process.cwd())
  .option('--ignore-files <files>', 'Comma-separated list of ignore files to use', '.gitignore,.dockerignore,.dryignore')
  .action(async (discoverPath, options) => {
    try {
      const resolvedPath = path.resolve(discoverPath);
      
      const config = resolveConfig(resolvedPath, { ...program.opts(), ...options });
      initLogger(config);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Path does not exist: ${resolvedPath}`);
      }
      
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }

      const ignoreFiles = options.ignoreFiles 
        ? options.ignoreFiles.split(',').map((f: string) => f.trim())
        : ['.gitignore', '.dockerignore', '.dryignore'];

      // Discover extensions
      const discoveredExtensions = detectExtensions(resolvedPath, ignoreFiles);
      
      // Get excluded directories from ignore patterns
      const ignorePatterns = loadIgnoreFiles(resolvedPath, ignoreFiles);
      const excludedDirs = new Set<string>();
      
      for (const pattern of ignorePatterns) {
        let dirName: string | null = null;
        
        // Patterns ending with / are directories
        if (pattern.endsWith('/')) {
          dirName = pattern.slice(0, -1);
        } else if (pattern.startsWith('/')) {
          // Absolute patterns like "/dist" or "/node_modules"
          dirName = pattern.slice(1);
        } else if (pattern.includes('**/')) {
          // Patterns like "**/node_modules/**" or "**/dist"
          const match = pattern.match(/\*\*\/([^/*?]+)/);
          if (match && match[1]) {
            dirName = match[1];
          }
        } else if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('/')) {
          // Simple patterns without wildcards or slashes (likely directories)
          // Only if they don't look like file extensions
          if (!pattern.includes('.')) {
            dirName = pattern;
          }
        } else if (pattern.includes('/') && !pattern.includes('*') && !pattern.includes('?')) {
          // Patterns like "server/dist" - extract the last directory component
          const parts = pattern.split('/').filter(p => p && !p.includes('.'));
          if (parts.length > 0) {
            dirName = parts[parts.length - 1];
          }
        }
        
        // Only add if it looks like a directory name (no dots, reasonable length)
        if (dirName && !dirName.includes('.') && dirName.length > 0 && dirName.length < 50) {
          excludedDirs.add(dirName);
        }
      }

      // Format output
      const extensionsStr = discoveredExtensions.length > 0
        ? discoveredExtensions.map(ext => `'${ext}'`).join(', ')
        : '(none)';
      
      const excludedDirsArray = Array.from(excludedDirs).sort();
      const excludedDirsStr = excludedDirsArray.length > 0
        ? excludedDirsArray.map(dir => `'${dir}'`).join(', ')
        : '(none)';

      logger.info(`DISCOVERED EXTENSIONS: ${extensionsStr}`);
      logger.info(`EXCLUDED DIRECTORIES: ${excludedDirsStr}`);
    } catch (error: any) {
      logger.error(`${error.message}`);
      process.exit(1);
    }
  });

program
  .command('similar')
  .description('Find the most similar element pairs across all indexed elements')
  .option('-t, --threshold <threshold>', 'Similarity threshold (0-1)')
  .option('-l, --limit <limit>', 'Maximum number of results')
  .option('--on-exceed <action>', 'Action when similar matches exceed limit ("warn" or "fail")')
  .action(async (options) => {
    try {
      const config = resolveConfig(process.cwd(), { ...program.opts(), ...options });
      initLogger(config);

      const serverUrl = config.server?.url || 'http://localhost:3000';
      const threshold = parseFloat(options.threshold || config.scan?.similarity?.threshold?.toString() || '0.8');
      const limit = parseInt(options.limit || config.scan?.similarity?.limit?.toString() || '10');
      const onExceed = options.onExceed || config.scan?.similarity?.onExceed || 'warn';

      const client = new DryClient(serverUrl);
      
      logger.info(`Using server: ${serverUrl}`);
      logger.info(`Finding most similar pairs (threshold: ${threshold}, limit: ${limit})...`);
      
      // Fetch limit + 1 to detect if the limit is exceeded
      const pairs = await client.findMostSimilarPairs(threshold, limit + 1);
      
      if (pairs.length === 0) {
        logger.info('No similar element pairs found.');
        return;
      }

      const resultsToShow = pairs.slice(0, limit);
      logger.log(`Found ${pairs.length > limit ? 'more than ' : ''}${resultsToShow.length} similar element pairs:`);
      resultsToShow.forEach((pair, index) => {
        const { element1, element2, similarity } = pair;
        logger.log(`\n${index + 1}. Similarity: ${(similarity * 100).toFixed(1)}%`);
        logger.log(`   Element 1: ${element1.metadata.elementName} (${element1.metadata.filePath}:${element1.metadata.lineNumber})`);
        logger.log(`   Element 2: ${element2.metadata.elementName} (${element2.metadata.filePath}:${element2.metadata.lineNumber})`);
        logger.log(`   ---`);
        // Show snippet of both? Or just one? Let's show a snippet of both to compare.
        logger.log(`   Element 1 Snippet:`);
        logger.log(element1.elementString.split('\n').slice(0, 3).join('\n'));
        if (element1.elementString.split('\n').length > 3) logger.log('   ...');
        logger.log(`   Element 2 Snippet:`);
        logger.log(element2.elementString.split('\n').slice(0, 3).join('\n'));
        if (element2.elementString.split('\n').length > 3) logger.log('   ...');
      });

      handleExceed(pairs.length, limit, onExceed as 'warn' | 'fail');
    } catch (error: any) {
      logger.error(`${error.message}`);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Perform a semantic search for code elements')
  .argument('<query...>', 'Search query string')
  .option('-t, --threshold <threshold>', 'Similarity threshold (0-1)')
  .option('-l, --limit <limit>', 'Maximum number of results')
  .option('-u, --url <url>', 'DRY server URL (overrides config)')
  .action(async (queryParts, options) => {
    try {
      const query = queryParts.join(' ');
      const config = resolveConfig(process.cwd(), { ...program.opts(), ...options });
      initLogger(config);

      const serverUrl = config.server?.url || 'http://localhost:3000';
      // Default threshold for semantic search is lower than for code similarity (0.5 vs 0.8)
      const threshold = parseFloat(options.threshold || '0.5');
      const limit = parseInt(options.limit || config.scan?.similarity?.limit?.toString() || '10');

      const client = new DryClient(serverUrl);
      
      logger.info(`Using server: ${serverUrl}`);
      logger.info(`Searching for: "${query}" (threshold: ${threshold}, limit: ${limit})...`);
      
      const results = await client.search(query, threshold, limit);
      
      if (results.length === 0) {
        logger.info('No matching elements found.');
        return;
      }

      logger.log(`\nFound ${results.length} results:`);
      results.forEach((result, index) => {
        const { element, similarity } = result;
        logger.log(`\n${index + 1}. ${element.metadata.elementName} (Similarity: ${(similarity * 100).toFixed(1)}%)`);
        logger.log(`   File: ${element.metadata.filePath}:${element.metadata.lineNumber}`);
        logger.log(`   ---`);
        logger.log(element.elementString.split('\n').slice(0, 5).join('\n'));
        if (element.elementString.split('\n').length > 5) logger.log('   ...');
      });
    } catch (error: any) {
      logger.error(`${error.message}`);
      process.exit(1);
    }
  });

program.parse();

