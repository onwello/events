import { BenchmarkLogger } from '../types';
import chalk from 'chalk';

export class ConsoleLogger implements BenchmarkLogger {
  info(message: string): void {
    console.log(chalk.blue(`ℹ️  ${message}`));
  }

  warn(message: string): void {
    console.log(chalk.yellow(`⚠️  ${message}`));
  }

  error(message: string): void {
    console.log(chalk.red(`❌ ${message}`));
  }

  debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`🔍 ${message}`));
    }
  }

  progress(message: string): void {
    // Use process.stdout.write to avoid line breaks for progress updates
    process.stdout.write(chalk.cyan(`⏳ ${message}\r`));
  }

  success(message: string): void {
    console.log(chalk.green(`✅ ${message}`));
  }

  // Additional logging methods for better UX
  section(title: string): void {
    console.log('\n' + chalk.bold.blue(`📋 ${title}`));
    console.log(chalk.gray('─'.repeat(title.length + 4)));
  }

  subsection(title: string): void {
    console.log(chalk.bold.cyan(`  ${title}`));
  }

  table(data: Record<string, any>[]): void {
    if (data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const columnWidths = headers.map(header => {
      const maxWidth = Math.max(
        header.length,
        ...data.map(row => String(row[header] || '').length)
      );
      return Math.min(maxWidth, 30); // Cap at 30 characters
    });
    
    // Print header
    const headerRow = headers.map((header, i) => 
      chalk.bold(header.padEnd(columnWidths[i]))
    ).join(' | ');
    console.log(headerRow);
    console.log(chalk.gray('─'.repeat(headerRow.length)));
    
    // Print data rows
    data.forEach(row => {
      const dataRow = headers.map((header, i) => {
        const value = String(row[header] || '');
        return value.padEnd(columnWidths[i]);
      }).join(' | ');
      console.log(dataRow);
    });
  }

  // Progress bar for long-running operations
  progressBar(current: number, total: number, width: number = 40): void {
    const percentage = current / total;
    const filledWidth = Math.round(width * percentage);
    const emptyWidth = width - filledWidth;
    
    const filled = '█'.repeat(filledWidth);
    const empty = '░'.repeat(emptyWidth);
    const percentText = `${(percentage * 100).toFixed(1)}%`;
    
    const bar = `${filled}${empty}`;
    const progressText = `${current}/${total}`;
    
    process.stdout.write(chalk.cyan(`⏳ ${bar} ${percentText} (${progressText})\r`));
  }

  // Clear progress line
  clearProgress(): void {
    process.stdout.write(' '.repeat(process.stdout.columns || 80) + '\r');
  }

  // Timing utilities
  time(label: string): () => void {
    const start = process.hrtime.bigint();
    console.log(chalk.gray(`⏱️  ${label} started`));
    
    return () => {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e6; // Convert to milliseconds
      console.log(chalk.gray(`⏱️  ${label} completed in ${duration.toFixed(2)}ms`));
    };
  }

  // Memory usage logging
  logMemoryUsage(label: string = 'Current'): void {
    const memUsage = process.memoryUsage();
    const rss = (memUsage.rss / 1024 / 1024).toFixed(2);
    const heapUsed = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotal = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
    
    console.log(chalk.gray(`💾 ${label} Memory: RSS: ${rss}MB, Heap: ${heapUsed}MB/${heapTotal}MB`));
  }

  // Performance metrics logging
  logPerformanceMetrics(metrics: any): void {
    console.log(chalk.bold.magenta('\n📊 Performance Metrics'));
    
    if (metrics.latency) {
      console.log(chalk.yellow('  Latency (nanoseconds):'));
      console.log(`    Min:     ${metrics.latency.min?.toLocaleString() || 'N/A'}`);
      console.log(`    Max:     ${metrics.latency.max?.toLocaleString() || 'N/A'}`);
      console.log(`    Mean:    ${metrics.latency.mean?.toLocaleString() || 'N/A'}`);
      console.log(`    P95:     ${metrics.latency.p95?.toLocaleString() || 'N/A'}`);
      console.log(`    P99:     ${metrics.latency.p99?.toLocaleString() || 'N/A'}`);
    }
    
    if (metrics.throughput) {
      console.log(chalk.green('  Throughput:'));
      console.log(`    Messages/sec: ${metrics.throughput.messagesPerSecond?.toFixed(2) || 'N/A'}`);
      console.log(`    Bytes/sec:    ${(metrics.throughput.bytesPerSecond / 1024)?.toFixed(2) || 'N/A'} KB/s`);
    }
  }

  // Error details logging
  logErrorDetails(error: Error, context?: string): void {
    console.log(chalk.red(`\n❌ Error${context ? ` in ${context}` : ''}: ${error.message}`));
    
    if (error.stack) {
      console.log(chalk.gray('Stack trace:'));
      console.log(chalk.gray(error.stack));
    }
    
    if (process.env.DEBUG) {
      console.log(chalk.gray('Full error object:'), error);
    }
  }
}
