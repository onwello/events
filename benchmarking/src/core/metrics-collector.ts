import { BenchmarkMetrics, IterationResult } from '../types';
import { SystemMetrics } from './system-metrics';

export class MetricsCollector {
  private systemMetrics: SystemMetrics;
  private currentResults: IterationResult[] = [];

  constructor() {
    this.systemMetrics = new SystemMetrics();
  }

  async collect(results: IterationResult[]): Promise<BenchmarkMetrics> {
    this.currentResults = results;
    const startMetrics = await this.systemMetrics.capture();
    
    // Extract all message latencies from all iterations
    const allLatencies = this.extractAllLatencies(results);
    const throughputMetrics = this.calculateThroughputMetrics(results);
    const resourceMetrics = await this.calculateResourceMetrics(startMetrics);
    const reliabilityMetrics = this.calculateReliabilityMetrics(results);

    return {
      latency: this.calculateLatencyMetrics(allLatencies),
      throughput: throughputMetrics,
      resources: resourceMetrics,
      reliability: reliabilityMetrics
    };
  }

  private extractAllLatencies(results: IterationResult[]): number[] {
    const allLatencies: number[] = [];
    
    for (const result of results) {
      // Add individual message latencies
      for (const messageLatency of result.messageLatencies) {
        if (messageLatency.latency > 0) {
          allLatencies.push(messageLatency.latency);
        }
      }
    }
    
    return allLatencies;
  }

  private calculateLatencyMetrics(samples: number[]): BenchmarkMetrics['latency'] {
    if (samples.length === 0) {
      // Return default latency metrics for scenarios without latency (e.g., publishing-only)
      return {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        p99_9: 0,
        standardDeviation: 0,
        samples: []
      };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const n = samples.length;
    
    // Basic statistics
    const min = sorted[0];
    const max = sorted[n - 1];
    const mean = samples.reduce((sum, x) => sum + x, 0) / n;
    
    // Percentiles
    const p50 = this.calculatePercentile(sorted, 50);
    const p95 = this.calculatePercentile(sorted, 95);
    const p99 = this.calculatePercentile(sorted, 99);
    const p99_9 = this.calculatePercentile(sorted, 99.9);
    
    // Median
    const median = this.calculatePercentile(sorted, 50);
    
    // Standard deviation
    const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);

    return {
      min,
      max,
      mean,
      median,
      p50,
      p95,
      p99,
      p99_9,
      standardDeviation,
      samples
    };
  }

  private calculatePercentile(sorted: number[], percentile: number): number {
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    if (lower === upper) return sorted[lower];
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  private calculateThroughputMetrics(results: IterationResult[]): BenchmarkMetrics['throughput'] {
    // For publishing scenarios, use the throughput calculated by the scenario itself
    // since the benchmark runner overrides duration with full iteration time
    const iterationThroughputs: number[] = [];
    const iterationBytesPerSecond: number[] = [];
    
    for (const result of results) {
      const messageCount = result.receivedCount || result.publishedCount || 0;
      
      // Use scenario's calculated throughput if available, otherwise calculate from duration
      let iterationThroughput = 0;
      if (result.metadata?.throughput) {
        // Use the throughput calculated by the scenario (more accurate for publishing)
        iterationThroughput = result.metadata.throughput;
      } else {
        // Fallback to calculating from duration (for consumption scenarios)
        const durationSeconds = result.duration / 1e9;
        iterationThroughput = durationSeconds > 0 ? messageCount / durationSeconds : 0;
      }
      
      if (iterationThroughput > 0) {
        iterationThroughputs.push(iterationThroughput);
        
        // Calculate bytes per second for this iteration
        const messageSize = result.metadata?.messageSize || 1024;
        const iterationBytes = messageCount * messageSize;
        const iterationBytesPerSec = iterationBytes * (iterationThroughput / messageCount);
        iterationBytesPerSecond.push(iterationBytesPerSec);
      }
    }
    
    // Calculate average throughput across all iterations
    const messagesPerSecond = iterationThroughputs.length > 0 
      ? iterationThroughputs.reduce((sum, throughput) => sum + throughput, 0) / iterationThroughputs.length 
      : 0;
    
    const bytesPerSecond = iterationBytesPerSecond.length > 0 
      ? iterationBytesPerSecond.reduce((sum, bytesPerSec) => sum + bytesPerSec, 0) / iterationBytesPerSecond.length 
      : 0;
    
    // Calculate total messages and bytes across all iterations
    const totalMessages = results.reduce((sum, r) => sum + (r.receivedCount || r.publishedCount || 0), 0);
    const totalBytes = results.reduce((sum, r) => {
      const messageSize = r.metadata?.messageSize || 1024;
      const messageCount = r.receivedCount || r.publishedCount || 0;
      return sum + (messageCount * messageSize);
    }, 0);

    return {
      messagesPerSecond,
      bytesPerSecond,
      totalMessages,
      totalBytes
    };
  }

  private async calculateResourceMetrics(startMetrics: any): Promise<BenchmarkMetrics['resources']> {
    // Calculate resource metrics from all iterations
    const cpuUsages: number[] = [];
    const memoryUsages: number[] = [];
    const frameworkOverheads: Array<{cpuUsage: number, memoryUsage: number, cpuTimeMicroseconds?: number}> = [];
    const trafficRecordMemories: number[] = [];
    
    // Extract system metrics from each iteration
    for (const result of this.currentResults || []) {
      if (result.systemMetrics) {
        cpuUsages.push(result.systemMetrics.cpuUsage);
        memoryUsages.push(result.systemMetrics.memoryUsage);
        if (result.systemMetrics.frameworkOverhead) {
          frameworkOverheads.push(result.systemMetrics.frameworkOverhead);
        }
        if (result.systemMetrics.trafficRecordMemory !== undefined) {
          trafficRecordMemories.push(result.systemMetrics.trafficRecordMemory);
        }
      }
    }
    
    // Calculate averages
    const avgCpuUsage = cpuUsages.length > 0 ? cpuUsages.reduce((sum, usage) => sum + usage, 0) / cpuUsages.length : 0;
    const avgMemoryUsage = memoryUsages.length > 0 ? memoryUsages.reduce((sum, usage) => sum + usage, 0) / memoryUsages.length : 0;
    const maxMemoryUsage = memoryUsages.length > 0 ? Math.max(...memoryUsages) : 0;
    const avgTrafficRecordMemory = trafficRecordMemories.length > 0 ? trafficRecordMemories.reduce((sum, memory) => sum + memory, 0) / trafficRecordMemories.length : 0;
    
    // Calculate average framework overhead
    const avgFrameworkOverhead = frameworkOverheads.length > 0 ? {
      cpuUsage: frameworkOverheads.reduce((sum, overhead) => sum + overhead.cpuUsage, 0) / frameworkOverheads.length,
      memoryUsage: frameworkOverheads.reduce((sum, overhead) => sum + overhead.memoryUsage, 0) / frameworkOverheads.length,
      cpuTimeMicroseconds: frameworkOverheads.reduce((sum, overhead) => sum + (overhead.cpuTimeMicroseconds || 0), 0) / frameworkOverheads.length
    } : undefined;
    
    return {
      cpuUsage: avgCpuUsage,
      memoryUsage: avgMemoryUsage,
      maxMemoryUsage,
      cpuUsages,
      memoryUsages,
      frameworkOverhead: avgFrameworkOverhead,
      trafficRecordMemory: avgTrafficRecordMemory
    };
  }

  private calculateCpuUsage(startMetrics: any, endMetrics: any): number {
    // This is a simplified CPU calculation
    // In a real implementation, you'd want more sophisticated CPU monitoring
    if (startMetrics.cpu && endMetrics.cpu) {
      const startCpu = startMetrics.cpu;
      const endCpu = endMetrics.cpu;
      
      // Calculate CPU usage as percentage
      const totalCpu = endCpu.total - startCpu.total;
      const idleCpu = endCpu.idle - startCpu.idle;
      
      if (totalCpu > 0) {
        return ((totalCpu - idleCpu) / totalCpu) * 100;
      }
    }
    
    return 0;
  }

  private calculateMemoryUsage(startMetrics: any, endMetrics: any): number {
    if (startMetrics.memory && endMetrics.memory) {
      const startMem = startMetrics.memory;
      const endMem = endMetrics.memory;
      
      // Return peak memory usage during the benchmark
      return Math.max(startMem.used, endMem.used);
    }
    
    return process.memoryUsage().heapUsed;
  }

  private calculateReliabilityMetrics(results: IterationResult[]): BenchmarkMetrics['reliability'] {
    const totalPublished = results.reduce((sum, r) => sum + r.publishedCount, 0);
    const totalReceived = results.reduce((sum, r) => sum + r.receivedCount, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
    
    const messageLoss = totalPublished > 0 ? (totalPublished - totalReceived) / totalPublished : 0;
    const errorRate = totalPublished > 0 ? totalErrors / totalPublished : 0;

    return {
      messageLoss,
      duplicateMessages: 0, // TODO: Implement duplicate detection
      poisonMessages: 0,    // TODO: Implement poison message detection
      retryCount: 0,        // TODO: Implement retry counting
      errorRate
    };
  }
}
