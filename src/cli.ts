#!/usr/bin/env node
import { Command } from 'commander';
import { extractElements } from './extract';
import { DryClient } from './client';
import path from 'path';
import fs from 'fs';
import { resolveConfig, findConfigFile, detectExtensions, createConfigFile, loadIgnoreFiles } from './config';
import { minimatch } from 'minimatch';
import readline from 'readline';

const program = new Command();

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

program
  .name('dry')
  .description('Extract elements and find similar code using embeddings')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan a file or directory for elements and index them')
  .argument('<path>', 'File or directory to scan')
  .option('-r, --regex <regex>', 'Regex to match element signatures (overrides config)')
  .option('-e, --extensions <exts>', 'Comma-separated file extensions to scan (overrides config)')
  .option('-u, --url <url>', 'DRY server URL (overrides config)')
  .option('--list-similar', 'List the most similar functions after scanning', true)
  .option('--limit <limit>', 'Maximum number of similar pairs to list', '10')
  .option('--threshold <threshold>', 'Similarity threshold for listing similar functions (0-1)', '0.8')
  .action(async (scanPath, options) => {
    try {
      const resolvedPath = path.resolve(scanPath);
      let configPath = findConfigFile(resolvedPath);

      if (!configPath && fs.statSync(resolvedPath).isDirectory()) {
        const detected = detectExtensions(resolvedPath);
        if (detected.length > 0) {
          console.log(`No dry-scan.toml found. Detected potential source extensions: ${detected.join(', ')}`);
          const shouldCreate = await askYesNo('Would you like to create a dry-scan.toml with these extensions?');
          if (shouldCreate) {
            configPath = path.join(resolvedPath, 'dry-scan.toml');
            createConfigFile(configPath, detected);
            console.log(`Created ${configPath}`);
          }
        }
      }

      const config = resolveConfig(resolvedPath, options);
      
      const serverUrl = config.server?.url || 'http://localhost:3000';
      const languages = config.scan?.languages || {};
      const extensions = config.scan?.extensions || Object.keys(languages);
      const useIgnoreFiles = config.scan?.use_ignore_files || ['.gitignore', '.dockerignore', '.dryignore'];

      const rootPathForIgnore = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);
      const ignorePatterns = loadIgnoreFiles(rootPathForIgnore, useIgnoreFiles);
      
      const client = new DryClient(serverUrl);

      console.log(`Using server: ${serverUrl}`);
      console.log('Wiping previous scans...');
      const deletedCount = await client.wipeAllElements();
      console.log(`Deleted ${deletedCount} elements from previous scans.`);

      let filesToScan: string[] = [];
      const stats = fs.statSync(resolvedPath);

      if (stats.isFile()) {
        filesToScan = [resolvedPath];
      } else if (stats.isDirectory()) {
        console.log(`Searching for files in ${resolvedPath} with extensions: ${extensions.join(', ')}...`);
        filesToScan = getAllFiles(resolvedPath, extensions, ignorePatterns, resolvedPath);
      } else {
        throw new Error('Provided path is neither a file nor a directory');
      }

      if (filesToScan.length === 0) {
        console.log('No files found to scan.');
        return;
      }

      console.log(`Found ${filesToScan.length} files to scan.`);
      let totalElements = 0;

      for (const filePath of filesToScan) {
        console.log(`Scanning ${path.relative(process.cwd(), filePath)}...`);
        
        const ext = path.extname(filePath).toLowerCase().slice(1);
        let includePatterns: RegExp[] = [];
        let excludePatterns: RegExp[] = [];
        
        if (options.regex) {
          includePatterns = [new RegExp(options.regex, 'g')];
        } else if (languages[ext]) {
          includePatterns = languages[ext].include.map(p => new RegExp(p, 'g'));
          if (languages[ext].exclude) {
            excludePatterns = languages[ext].exclude!.map(p => new RegExp(p, 'g'));
          }
        } else {
          // Fallback to default regex if no language specific one is found
          includePatterns = [/\bfunction\s+(\w+)\s*\(/g];
        }

        const elements = extractElements(filePath, includePatterns, excludePatterns);
        
        if (elements.length === 0) continue;

        console.log(`  Found ${elements.length} elements. Submitting...`);
        for (const element of elements) {
          try {
            const id = await client.submitElement(element);
            console.log(`  Indexed: ${element.metadata.elementName} (ID: ${id})`);
            totalElements++;
          } catch (error: any) {
            console.error(`  Failed to index ${element.metadata.elementName}: ${error.message}`);
          }
        }
      }
      
      console.log(`\nDone. Indexed ${totalElements} elements from ${filesToScan.length} files.`);

      // List similar functions if requested
      if (options.listSimilar) {
        console.log('\nFinding most similar elements...');
        try {
          const threshold = parseFloat(options.threshold || config.scan?.similarity?.threshold?.toString() || '0.8');
          const limit = parseInt(options.limit || config.scan?.similarity?.limit?.toString() || '10');
          const pairs = await client.findMostSimilarPairs(threshold, limit);

          if (pairs.length === 0) {
            console.log('No similar elements found.');
          } else {
            console.log(`\nFound ${pairs.length} similar elements:`);
            pairs.forEach((pair, index) => {
              console.log(`\n${index + 1}. Similarity: ${(pair.similarity * 100).toFixed(1)}%`);
              console.log(`   Element 1: ${pair.element1.metadata.elementName}`);
              console.log(`              ${pair.element1.metadata.filePath}:${pair.element1.metadata.lineNumber}`);
              console.log(`   Element 2: ${pair.element2.metadata.elementName}`);
              console.log(`              ${pair.element2.metadata.filePath}:${pair.element2.metadata.lineNumber}`);
            });
          }
        } catch (error: any) {
          console.error(`Error finding similar elements: ${error.message}`);
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Recursively gets all files in a directory that match the given extensions and are not ignored.
 */
function getAllFiles(dirPath: string, extensions: string[], ignorePatterns: string[], rootPath: string): string[] {
  let results: string[] = [];
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

    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, extensions, ignorePatterns, rootPath));
    } else {
      const ext = path.extname(file).toLowerCase().slice(1);
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

program
  .command('similar')
  .description('Find elements similar to a given element ID')
  .argument('<id>', 'Element ID')
  .option('-t, --threshold <threshold>', 'Similarity threshold (0-1)')
  .option('-l, --limit <limit>', 'Maximum number of results')
  .option('-u, --url <url>', 'DRY server URL (overrides config)')
  .action(async (id, options) => {
    try {
      const config = resolveConfig(process.cwd(), options);
      const serverUrl = config.server?.url || 'http://localhost:3000';
      const threshold = parseFloat(options.threshold || config.scan?.similarity?.threshold?.toString() || '0.8');
      const limit = parseInt(options.limit || config.scan?.similarity?.limit?.toString() || '10');

      const client = new DryClient(serverUrl);
      
      console.log(`Using server: ${serverUrl}`);
      console.log(`Finding elements similar to ${id} (threshold: ${threshold}, limit: ${limit})...`);
      const similar = await client.findSimilar(id, threshold, limit);
      
      if (similar.length === 0) {
        console.log('No similar elements found.');
        return;
      }

      console.log(`Found ${similar.length} similar elements:`);
      similar.forEach((element, index) => {
        console.log(`\n${index + 1}. ${element.metadata.elementName}`);
        console.log(`   File: ${element.metadata.filePath}:${element.metadata.lineNumber}`);
        console.log(`   ---`);
        console.log(element.elementString.split('\n').slice(0, 5).join('\n'));
        if (element.elementString.split('\n').length > 5) console.log('   ...');
      });
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();

