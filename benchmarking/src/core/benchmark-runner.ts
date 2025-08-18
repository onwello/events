import { v4 as uuidv4 } from 'uuid';
import { 
  BenchmarkResult, 
  BenchmarkScenario, 
  BenchmarkContext, 
  BenchmarkConfiguration,
  EnvironmentInfo,
  BenchmarkLogger,
  TransportBenchmark,
  IterationResult
} from '../types';
import { MetricsCollector } from './metrics-collector';
import { StatisticalAnalyzer } from './statistical-analyzer';
import { EnvironmentDetector } from './environment-detector';
import { SystemMetrics } from './system-metrics';

export class BenchmarkRunner {
  private metricsCollector: MetricsCollector;
  private statisticalAnalyzer: StatisticalAnalyzer;
  private environmentDetector: EnvironmentDetector;
  private systemMetrics: SystemMetrics;
  private logger: BenchmarkLogger;

  constructor(logger: BenchmarkLogger) {
    this.logger = logger;
    this.metricsCollector = new MetricsCollector();
    this.statisticalAnalyzer = new StatisticalAnalyzer();
    this.environmentDetector = new EnvironmentDetector();
    this.systemMetrics = new SystemMetrics();
  }

  async runScenario(
    scenario: BenchmarkScenario,
    transport: TransportBenchmark,
    config: BenchmarkConfiguration
  ): Promise<BenchmarkResult> {
    const resultId = uuidv4();
    this.logger.info(`Starting benchmark: ${scenario.name} (ID: ${resultId})`);
    
    try {
      // Detect environment
      const environment = await this.environmentDetector.detect();
      
      // Validate transport capabilities against scenario requirements
      const capabilityCheck = this.validateCapabilities(scenario, transport);
      if (!capabilityCheck.valid) {
        throw new Error(`Transport ${transport.name} does not meet scenario requirements: ${capabilityCheck.errors.join(', ')}`);
      }

      // Measure framework overhead BEFORE creating transport or running scenarios
      const frameworkOverhead = await this.measureFrameworkOverhead();
      
      // Create transport instance
      this.logger.debug('Creating transport instance...');
      const transportInstance = await transport.createTransport(config.transportConfig);
      
      // Warmup runs
      if (config.warmupRuns > 0) {
        this.logger.info(`Running ${config.warmupRuns} warmup iterations...`);
        await this.runWarmup(scenario, transportInstance, transport.capabilities, config, environment);
      }

      // Main benchmark iterations
      this.logger.info(`Running ${config.iterations} benchmark iterations...`);
      const results = await this.runIterations(scenario, transportInstance, transport.capabilities, config, environment, frameworkOverhead);
      
      // Collect and analyze metrics
      const metrics = await this.metricsCollector.collect(results);
      const statisticalSummary = this.statisticalAnalyzer.analyze(metrics.latency.samples);
      
      // Cleanup
      await transport.cleanup();
      
      const benchmarkResult: BenchmarkResult = {
        id: resultId,
        name: scenario.name,
        transport: transport.name,
        timestamp: new Date().toISOString(),
        duration: this.calculateTotalDuration(results),
        sampleCount: results.length,
        metrics,
        environment,
        configuration: config,
        statisticalSummary
      };

      this.logger.info(`Benchmark completed: ${scenario.name}`);
      this.logger.info(`Results: ${results.length} samples, ${metrics.throughput.messagesPerSecond.toFixed(2)} msg/s`);
      
      return benchmarkResult;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Benchmark failed: ${scenario.name} - ${errorMessage}`);
      throw error;
    }
  }

  private validateCapabilities(
    scenario: BenchmarkScenario, 
    transport: TransportBenchmark
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const required = scenario.requiredCapabilities;
    
    for (const [capability, requiredValue] of Object.entries(required)) {
      const transportValue = (transport.capabilities as any)[capability];
      
      if (typeof requiredValue === 'boolean' && requiredValue && !transportValue) {
        errors.push(`Required capability '${capability}' not supported`);
      } else if (typeof requiredValue === 'number' && transportValue < requiredValue) {
        errors.push(`Capability '${capability}' insufficient: required ${requiredValue}, got ${transportValue}`);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

  private async runWarmup(
    scenario: BenchmarkScenario,
    transport: any,
    capabilities: any,
    config: BenchmarkConfiguration,
    environment: EnvironmentInfo
  ): Promise<void> {
    for (let i = 0; i < config.warmupRuns; i++) {
      this.logger.debug(`Warmup iteration ${i + 1}/${config.warmupRuns}`);
      
      const warmupScenario = this.createFreshScenario(scenario);
      const iterationId = `warmup-${uuidv4()}`;
      
      const context: BenchmarkContext = {
        transport,
        capabilities,
        configuration: config,
        environment,
        logger: this.logger,
        iteration: i + 1,
        iterationId
      };
      
      await warmupScenario.execute(context);
      
      if (config.cooldownMs > 0) {
        await this.sleep(config.cooldownMs);
      }
    }
  }

  private async runIterations(
    scenario: BenchmarkScenario,
    transportInstance: any,
    capabilities: any,
    config: BenchmarkConfiguration,
    environment: EnvironmentInfo,
    frameworkOverhead: {cpuUsage: number, memoryUsage: number, cpuTimeMicroseconds: number}
  ): Promise<IterationResult[]> {
    const results: IterationResult[] = [];

    try {
      for (let i = 0; i < config.iterations; i++) {
        this.logger.progress(`Iteration ${i + 1}/${config.iterations}`);
        
        // Create a fresh scenario instance for each iteration to ensure clean state
        const freshScenario = this.createFreshScenario(scenario);
        const iterationId = `iteration-${uuidv4()}`;
        
        const context: BenchmarkContext = {
          transport: transportInstance,
          capabilities,
          configuration: config,
          environment,
          logger: this.logger,
          iteration: i + 1,
          iterationId
        };
        
        // Capture system metrics and process CPU before iteration
        const startMetrics = await this.systemMetrics.capture();
        const startCpuUsage = process.cpuUsage();
        const startTime = process.hrtime.bigint();
        
        const result = await freshScenario.execute(context);
        
        const endTime = process.hrtime.bigint();
        const endCpuUsage = process.cpuUsage();
        
        // Capture system metrics after iteration
        const endMetrics = await this.systemMetrics.capture();
        
        // Override the duration with the actual execution time
        result.duration = Number(endTime - startTime);
        
        // Calculate CPU usage and subtract framework overhead
        const totalCpuUsage = this.calculateCpuUsage(startCpuUsage, endCpuUsage, result.duration);
        const actualCpuUsage = Math.max(0, totalCpuUsage - frameworkOverhead.cpuUsage);
        
        // Calculate traffic record memory usage if this is an E2E latency scenario
        let trafficRecordMemory = 0;
        if (scenario.name === 'e2e-latency') {
          const { E2ELatencyScenario } = await import('../scenarios/e2e-latency-scenario');
          trafficRecordMemory = E2ELatencyScenario.getTrafficRecordMemoryUsage();
        }
        
        // Calculate memory usage and subtract framework overhead and traffic record
        const totalMemoryUsage = this.calculateMemoryUsage(startMetrics, endMetrics);
        const actualMemoryUsage = Math.max(0, totalMemoryUsage - frameworkOverhead.memoryUsage - trafficRecordMemory);
        
        // Add system metrics to the result
        result.systemMetrics = {
          start: startMetrics,
          end: endMetrics,
          cpuUsage: actualCpuUsage,
          memoryUsage: actualMemoryUsage,
          frameworkOverhead: {
            cpuUsage: frameworkOverhead.cpuUsage,
            memoryUsage: frameworkOverhead.memoryUsage,
            cpuTimeMicroseconds: frameworkOverhead.cpuTimeMicroseconds
          },
          trafficRecordMemory: trafficRecordMemory
        };
        
        this.logger.debug(`Iteration ${i + 1} completed: ${result.receivedCount}/${result.publishedCount} messages, ${result.messageLatencies.length} latencies`);
        
        results.push(result);
        
        if (config.cooldownMs > 0 && i < config.iterations - 1) {
          await this.sleep(config.cooldownMs);
        }
      }
    } finally {
      // Clean up the transport instance
      try {
        if (transportInstance && typeof transportInstance.close === 'function') {
          await transportInstance.close();
        }
      } catch (error) {
        this.logger.warn(`Failed to close transport: ${error}`);
      }
    }

    return results;
  }

  private calculateTotalDuration(results: IterationResult[]): number {
    return results.reduce((total, result) => total + result.duration, 0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private calculateCpuUsage(startCpuUsage: any, endCpuUsage: any, duration: number): number {
    // Calculate CPU usage as percentage of total available CPU time
    const userDelta = endCpuUsage.user - startCpuUsage.user;
    const systemDelta = endCpuUsage.system - startCpuUsage.system;
    const totalCpuTime = userDelta + systemDelta;
    
    // Convert duration from nanoseconds to microseconds to match process.cpuUsage()
    const durationMicroseconds = duration / 1000;
    
    // Calculate CPU usage as percentage (how much of the available CPU time was used)
    // For a single-core system, this represents CPU utilization percentage
    // For multi-core systems, this represents the fraction of one core used
    const cpuUsagePercentage = durationMicroseconds > 0 ? (totalCpuTime / durationMicroseconds) * 100 : 0;
    
    return Math.max(0, Math.min(100, cpuUsagePercentage));
  }

  private calculateMemoryUsage(startMetrics: any, endMetrics: any): number {
    if (startMetrics.memory && endMetrics.memory) {
      const startMem = startMetrics.memory;
      const endMem = endMetrics.memory;
      
      // Return peak memory usage during the iteration (in MB)
      const peakUsed = Math.max(startMem.heapUsed, endMem.heapUsed);
      return peakUsed / (1024 * 1024); // Convert to MB
    }
    
    return process.memoryUsage().heapUsed / (1024 * 1024); // Convert to MB
  }

  private async measureFrameworkOverhead(): Promise<{cpuUsage: number, memoryUsage: number, cpuTimeMicroseconds: number}> {
    // Measure the overhead of framework operations without actual event processing
    const overheadSamples = 5;
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;
    let totalCpuTimeMicroseconds = 0;
    
    for (let i = 0; i < overheadSamples; i++) {
      // Simulate framework operations without actual event processing
      const startCpu = process.cpuUsage();
      const startMemory = process.memoryUsage();
      const startTime = process.hrtime.bigint();
      
      // Simulate framework overhead operations
      await this.simulateFrameworkOperations();
      
      const endTime = process.hrtime.bigint();
      const endCpu = process.cpuUsage();
      const endMemory = process.memoryUsage();
      
      const duration = Number(endTime - startTime);
      const cpuUsage = this.calculateCpuUsage(startCpu, endCpu, duration);
      const memoryUsage = Math.max(startMemory.heapUsed, endMemory.heapUsed) / (1024 * 1024);
      
      // Calculate absolute CPU time in microseconds
      const userDelta = endCpu.user - startCpu.user;
      const systemDelta = endCpu.system - startCpu.system;
      const cpuTimeMicroseconds = userDelta + systemDelta;
      
      totalCpuUsage += cpuUsage;
      totalMemoryUsage += memoryUsage;
      totalCpuTimeMicroseconds += cpuTimeMicroseconds;
    }
    
    return {
      cpuUsage: totalCpuUsage / overheadSamples,
      memoryUsage: totalMemoryUsage / overheadSamples,
      cpuTimeMicroseconds: totalCpuTimeMicroseconds / overheadSamples
    };
  }

  private async simulateFrameworkOperations(): Promise<void> {
    // Simulate ONLY framework operations, not event system operations
    const operations = [
      () => process.cpuUsage(), // CPU measurement
      () => process.memoryUsage(), // Memory measurement
      () => process.hrtime.bigint(), // Timing
      () => uuidv4(), // UUID generation for framework
      () => this.logger.debug('Framework operation'), // Logging
    ];
    
    // Execute operations multiple times to simulate iteration overhead
    for (let i = 0; i < 10; i++) {
      for (const operation of operations) {
        operation();
      }
    }
    
    // Simulate system metrics capture (but not the actual system calls)
    await this.systemMetrics.capture();
  }

  private createFreshScenario(scenario: BenchmarkScenario): BenchmarkScenario {
    // Create a fresh instance of the scenario class
    const ScenarioClass = scenario.constructor;
    return new (ScenarioClass as any)();
  }
}
