import { TopicConfig, TopicMetadata } from './topic-manager';

export interface TopicWarning {
  type: 'topic_length' | 'trim_ineffective' | 'security_violation' | 'backpressure';
  message: string;
  topic: string;
  details?: any;
  timestamp: Date;
}

export interface TopicIsolation {
  enabled: boolean;
  environment?: string; // 'dev', 'staging', 'prod'
  namespace?: string;
}

export interface TopicSecurity {
  allowedTopics?: string[];
  deniedTopics?: string[];
  topicPatterns?: RegExp[];
  multiTenant?: boolean;
  tenantResolver?: (payload?: any, metadata?: any) => string;
}

export interface TopicWarnings {
  topicLengthThreshold?: number; // Warn when topic exceeds 2x maxLength
  trimEffectivenessThreshold?: number; // Warn when trimming is ineffective
  backpressureThreshold?: number; // Warn when pending messages exceed threshold
  onWarning?: (topic: string, warning: TopicWarning) => void;
}

export interface EnhancedTopicConfiguration {
  defaultTopic?: string;
  topicPrefix?: string;
  topicValidation?: boolean;
  topicNamingStrategy?: 'namespace' | 'explicit' | 'custom' | 'dynamic';
  customTopicResolver?: (eventType: string, payload?: any, metadata?: any) => string;
  topicIsolation?: TopicIsolation;
  security?: TopicSecurity;
  warnings?: TopicWarnings;
  autoCreateTopics?: boolean;
  topicDefaults?: Partial<TopicConfig>;
}

export type TopicNamingStrategy = 'namespace' | 'explicit' | 'custom' | 'dynamic';

export class EnhancedTopicConfigurationManager {
  private config: EnhancedTopicConfiguration;
  private topicCache: Map<string, string> = new Map();
  private warningHistory: TopicWarning[] = [];

  constructor(config: EnhancedTopicConfiguration) {
    this.config = config;
  }

  /**
   * Resolve topic name based on configuration and event data
   */
  resolveTopicName(eventType: string, payload?: any, metadata?: any): string {
    const cacheKey = `${eventType}-${JSON.stringify(payload)}-${JSON.stringify(metadata)}`;
    
    if (this.topicCache.has(cacheKey)) {
      return this.topicCache.get(cacheKey)!;
    }

    let topicName: string;

    switch (this.config.topicNamingStrategy) {
      case 'explicit':
        topicName = this.config.defaultTopic || 'default-events';
        break;
      
      case 'namespace':
        topicName = this.buildNamespaceTopic(eventType);
        break;
      
      case 'custom':
        topicName = this.config.customTopicResolver?.(eventType, payload, metadata) || 'default-events';
        break;
      
      case 'dynamic':
        topicName = this.resolveDynamicTopic(eventType, payload, metadata);
        break;
      
      default:
        topicName = this.config.defaultTopic || 'default-events';
    }

    // Apply topic isolation
    if (this.config.topicIsolation?.enabled) {
      topicName = this.applyTopicIsolation(topicName);
    }

    // Apply security validation
    this.validateTopicSecurity(topicName, payload, metadata);

    // Cache the resolved topic name
    this.topicCache.set(cacheKey, topicName);
    
    return topicName;
  }

  /**
   * Build namespace-based topic name
   */
  private buildNamespaceTopic(eventType: string): string {
    const parts = eventType.split('.');
    const namespace = parts.slice(0, -1).join('-');
    const eventName = parts[parts.length - 1];
    
    return namespace ? `${namespace}-${eventName}-events` : `${eventName}-events`;
  }

  /**
   * Resolve dynamic topic based on payload and metadata
   */
  private resolveDynamicTopic(eventType: string, payload?: any, metadata?: any): string {
    // Multi-tenant support
    if (this.config.security?.multiTenant && this.config.security.tenantResolver) {
      const tenant = this.config.security.tenantResolver(payload, metadata);
      if (tenant) {
        return `${tenant}-${eventType}-events`;
      }
    }

    // Priority-based routing
    if (payload?.priority === 'high') {
      return `high-priority-${eventType}-events`;
    }

    // Event type-based routing
    if (eventType.includes('user')) {
      return 'user-events';
    }
    if (eventType.includes('order')) {
      return 'order-events';
    }
    if (eventType.includes('payment')) {
      return 'payment-events';
    }

    // Default fallback
    return this.config.defaultTopic || `${eventType}-events`;
  }

  /**
   * Apply topic isolation (environment/namespace prefixes)
   */
  private applyTopicIsolation(topicName: string): string {
    const isolation = this.config.topicIsolation!;
    const parts: string[] = [];

    if (isolation.environment) {
      parts.push(isolation.environment);
    }
    if (isolation.namespace) {
      parts.push(isolation.namespace);
    }

    return parts.length > 0 ? `${parts.join('-')}-${topicName}` : topicName;
  }

  /**
   * Validate topic security policies
   */
  private validateTopicSecurity(topicName: string, payload?: any, metadata?: any): void {
    const security = this.config.security;
    if (!security) return;

    // Check denied topics
    if (security.deniedTopics?.includes(topicName)) {
      this.emitWarning(topicName, {
        type: 'security_violation',
        message: `Topic '${topicName}' is in denied list`,
        topic: topicName,
        details: { payload, metadata },
        timestamp: new Date()
      });
      throw new Error(`Topic '${topicName}' is not allowed`);
    }

    // Check allowed topics (if specified, only these are allowed)
    if (security.allowedTopics && !security.allowedTopics.includes(topicName)) {
      this.emitWarning(topicName, {
        type: 'security_violation',
        message: `Topic '${topicName}' is not in allowed list`,
        topic: topicName,
        details: { payload, metadata },
        timestamp: new Date()
      });
      throw new Error(`Topic '${topicName}' is not allowed`);
    }

    // Check topic patterns
    if (security.topicPatterns) {
      const isAllowed = security.topicPatterns.some(pattern => pattern.test(topicName));
      if (!isAllowed) {
        this.emitWarning(topicName, {
          type: 'security_violation',
          message: `Topic '${topicName}' does not match allowed patterns`,
          topic: topicName,
          details: { payload, metadata },
          timestamp: new Date()
        });
        throw new Error(`Topic '${topicName}' does not match allowed patterns`);
      }
    }
  }

  /**
   * Check topic length and emit warnings if needed
   */
  async checkTopicLength(topicName: string, currentLength: number, maxLength?: number): Promise<void> {
    if (!this.config.warnings?.topicLengthThreshold || !maxLength) return;

    const threshold = maxLength * 2; // 2x maxLength as specified in roadmap
    if (currentLength > threshold) {
      this.emitWarning(topicName, {
        type: 'topic_length',
        message: `Topic '${topicName}' length (${currentLength}) exceeds 2x maxLength (${threshold})`,
        topic: topicName,
        details: { currentLength, threshold, maxLength },
        timestamp: new Date()
      });
    }
  }

  /**
   * Check trim effectiveness and emit warnings if needed
   */
  checkTrimEffectiveness(topicName: string, beforeLength: number, afterLength: number): void {
    if (!this.config.warnings?.trimEffectivenessThreshold) return;

    const reduction = beforeLength - afterLength;
    const effectiveness = beforeLength > 0 ? reduction / beforeLength : 0;

    if (effectiveness < this.config.warnings.trimEffectivenessThreshold) {
      this.emitWarning(topicName, {
        type: 'trim_ineffective',
        message: `Topic '${topicName}' trimming was ineffective: ${beforeLength} -> ${afterLength} (${(effectiveness * 100).toFixed(1)}% reduction)`,
        topic: topicName,
        details: { beforeLength, afterLength, effectiveness },
        timestamp: new Date()
      });
    }
  }

  /**
   * Check backpressure and emit warnings if needed
   */
  checkBackpressure(topicName: string, pendingCount: number): void {
    if (!this.config.warnings?.backpressureThreshold) return;

    if (pendingCount > this.config.warnings.backpressureThreshold) {
      this.emitWarning(topicName, {
        type: 'backpressure',
        message: `Topic '${topicName}' has high backpressure: ${pendingCount} pending messages`,
        topic: topicName,
        details: { pendingCount, threshold: this.config.warnings.backpressureThreshold },
        timestamp: new Date()
      });
    }
  }

  /**
   * Emit warning through configured callback
   */
  private emitWarning(topic: string, warning: TopicWarning): void {
    this.warningHistory.push(warning);
    this.config.warnings?.onWarning?.(topic, warning);
  }

  /**
   * Get warning history
   */
  getWarningHistory(): TopicWarning[] {
    return [...this.warningHistory];
  }

  /**
   * Clear warning history
   */
  clearWarningHistory(): void {
    this.warningHistory = [];
  }

  /**
   * Get configuration
   */
  getConfiguration(): EnhancedTopicConfiguration {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfiguration(updates: Partial<EnhancedTopicConfiguration>): void {
    this.config = { ...this.config, ...updates };
    this.topicCache.clear(); // Clear cache when config changes
  }

  /**
   * Get default topic configuration
   */
  getDefaultTopicConfig(): Partial<TopicConfig> {
    return this.config.topicDefaults || {
      partitions: 1,
      retention: {
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        maxSize: 10000
      },
      ordering: 'strict'
    };
  }
}
