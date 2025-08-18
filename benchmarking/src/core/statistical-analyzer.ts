import { StatisticalSummary } from '../types';

export class StatisticalAnalyzer {
  analyze(samples: number[]): StatisticalSummary {
    if (samples.length < 2) {
      throw new Error('Need at least 2 samples for statistical analysis');
    }

    const n = samples.length;
    const mean = samples.reduce((sum, x) => sum + x, 0) / n;
    
    // Calculate standard error
    const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (n - 1);
    const standardDeviation = Math.sqrt(variance);
    const standardError = standardDeviation / Math.sqrt(n);
    
    // Calculate confidence intervals
    const confidenceInterval95 = this.calculateConfidenceInterval(samples, mean, standardError, 0.95);
    const confidenceInterval99 = this.calculateConfidenceInterval(samples, mean, standardError, 0.99);
    
    // Check for normal distribution using Shapiro-Wilk approximation
    const isNormalDistribution = this.isApproximatelyNormal(samples);
    
    // Detect outliers using IQR method
    const outlierCount = this.detectOutliers(samples).length;
    
    // Calculate coefficient of variation
    const coefficientOfVariation = mean > 0 ? standardDeviation / mean : 0;

    return {
      confidenceInterval95,
      confidenceInterval99,
      standardError,
      coefficientOfVariation,
      isNormalDistribution,
      outlierCount
    };
  }

  private calculateConfidenceInterval(
    samples: number[], 
    mean: number, 
    standardError: number, 
    confidenceLevel: number
  ): { lower: number; upper: number; marginOfError: number } {
    const n = samples.length;
    
    // Use t-distribution for small samples, normal distribution for large samples
    let criticalValue: number;
    
    if (n < 30) {
      // t-distribution (approximate for simplicity)
      criticalValue = this.getTDistributionCriticalValue(n - 1, confidenceLevel);
    } else {
      // Normal distribution
      criticalValue = this.getNormalDistributionCriticalValue(confidenceLevel);
    }
    
    const marginOfError = criticalValue * standardError;
    
    return {
      lower: mean - marginOfError,
      upper: mean + marginOfError,
      marginOfError
    };
  }

  private getTDistributionCriticalValue(degreesOfFreedom: number, confidenceLevel: number): number {
    // Simplified t-distribution critical values
    // In a production system, you'd want to use a proper statistical library
    const criticalValues: Record<number, Record<number, number>> = {
      0.90: { 5: 2.015, 10: 1.812, 15: 1.753, 20: 1.725, 25: 1.708, 30: 1.697 },
      0.95: { 5: 2.571, 10: 2.228, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042 },
      0.99: { 5: 4.032, 10: 3.169, 15: 2.947, 20: 2.845, 25: 2.787, 30: 2.750 }
    };
    
    const level = confidenceLevel;
    const df = Math.min(degreesOfFreedom, 30);
    
    // Find the closest degrees of freedom
    const availableDfs = Object.keys(criticalValues[level]).map(Number).sort((a, b) => a - b);
    const closestDf = availableDfs.reduce((prev, curr) => 
      Math.abs(curr - df) < Math.abs(prev - df) ? curr : prev
    );
    
    return criticalValues[level][closestDf];
  }

  private getNormalDistributionCriticalValue(confidenceLevel: number): number {
    // Standard normal distribution critical values
    const criticalValues: Record<number, number> = {
      0.90: 1.645,
      0.95: 1.960,
      0.99: 2.576
    };
    
    return criticalValues[confidenceLevel] || 1.960;
  }

  private isApproximatelyNormal(samples: number[]): boolean {
    const n = samples.length;
    
    if (n < 3) return false;
    
    // Simplified normality test using skewness and kurtosis
    const mean = samples.reduce((sum, x) => sum + x, 0) / n;
    const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);
    
    if (standardDeviation === 0) return true;
    
    // Calculate skewness
    const skewness = samples.reduce((sum, x) => sum + Math.pow((x - mean) / standardDeviation, 3), 0) / n;
    
    // Calculate kurtosis
    const kurtosis = samples.reduce((sum, x) => sum + Math.pow((x - mean) / standardDeviation, 4), 0) / n;
    
    // Check if skewness and kurtosis are within reasonable bounds for normal distribution
    // Normal distribution has skewness ≈ 0 and kurtosis ≈ 3
    const skewnessThreshold = 2.0;
    const kurtosisThreshold = 2.0;
    
    return Math.abs(skewness) < skewnessThreshold && 
           Math.abs(kurtosis - 3) < kurtosisThreshold;
  }

  private detectOutliers(samples: number[]): number[] {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    
    if (n < 4) return [];
    
    // Calculate Q1, Q3, and IQR
    const q1Index = Math.floor((n + 1) * 0.25);
    const q3Index = Math.floor((n + 1) * 0.75);
    
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    
    // Define outlier boundaries (1.5 * IQR rule)
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    return samples.filter(x => x < lowerBound || x > upperBound);
  }

  // Additional statistical methods
  calculatePercentile(samples: number[], percentile: number): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    if (lower === upper) return sorted[lower];
    
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  calculateGeometricMean(samples: number[]): number {
    const product = samples.reduce((prod, x) => prod * x, 1);
    return Math.pow(product, 1 / samples.length);
  }

  calculateHarmonicMean(samples: number[]): number {
    const sum = samples.reduce((sum, x) => sum + 1 / x, 0);
    return samples.length / sum;
  }

  // Bootstrap confidence interval (more robust for non-normal data)
  calculateBootstrapConfidenceInterval(
    samples: number[], 
    confidenceLevel: number, 
    bootstrapSamples: number = 1000
  ): { lower: number; upper: number } {
    const bootstrapMeans: number[] = [];
    
    for (let i = 0; i < bootstrapSamples; i++) {
      const bootstrapSample = this.generateBootstrapSample(samples);
      const mean = bootstrapSample.reduce((sum, x) => sum + x, 0) / bootstrapSample.length;
      bootstrapMeans.push(mean);
    }
    
    bootstrapMeans.sort((a, b) => a - b);
    
    const lowerPercentile = (1 - confidenceLevel) / 2;
    const upperPercentile = 1 - lowerPercentile;
    
    const lowerIndex = Math.floor(bootstrapMeans.length * lowerPercentile);
    const upperIndex = Math.floor(bootstrapMeans.length * upperPercentile);
    
    return {
      lower: bootstrapMeans[lowerIndex],
      upper: bootstrapMeans[upperIndex]
    };
  }

  private generateBootstrapSample(samples: number[]): number[] {
    const bootstrapSample: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const randomIndex = Math.floor(Math.random() * samples.length);
      bootstrapSample.push(samples[randomIndex]);
    }
    return bootstrapSample;
  }
}
