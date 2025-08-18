import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SystemMetrics {
  private startTime: number = 0;
  private startMemory: NodeJS.MemoryUsage | null = null;
  private startCpu: any = null;

  async capture(): Promise<any> {
    const timestamp = Date.now();
    
    // Capture memory usage
    const memory = process.memoryUsage();
    
    // Capture CPU usage (platform-specific)
    const cpu = await this.captureCpuUsage();
    
    // Capture system info
    const systemInfo = await this.getSystemInfo();
    
    return {
      timestamp,
      memory,
      cpu,
      systemInfo
    };
  }

  private async captureCpuUsage(): Promise<any> {
    try {
      if (process.platform === 'darwin') {
        return await this.captureDarwinCpu();
      } else if (process.platform === 'linux') {
        return await this.captureLinuxCpu();
      } else if (process.platform === 'win32') {
        return await this.captureWindowsCpu();
      } else {
        // Fallback for other platforms
        return this.captureFallbackCpu();
      }
    } catch (error) {
      // If platform-specific capture fails, fall back to basic method
      return this.captureFallbackCpu();
    }
  }

  private async captureDarwinCpu(): Promise<any> {
    try {
      const { stdout } = await execAsync('top -l 1 -n 0 | grep "CPU usage"');
      const match = stdout.match(/CPU usage: (\d+\.?\d*)% user, (\d+\.?\d*)% sys, (\d+\.?\d*)% idle/);
      
      if (match) {
        const user = parseFloat(match[1]);
        const sys = parseFloat(match[2]);
        const idle = parseFloat(match[3]);
        const total = user + sys + idle;
        
        return {
          user,
          sys,
          idle,
          total,
          used: user + sys
        };
      }
    } catch (error) {
      // Fall back to basic method
    }
    
    return this.captureFallbackCpu();
  }

  private async captureLinuxCpu(): Promise<any> {
    try {
      const { stdout } = await execAsync('cat /proc/stat | grep "^cpu "');
      const parts = stdout.trim().split(/\s+/);
      
      if (parts.length >= 5) {
        const user = parseInt(parts[1]);
        const nice = parseInt(parts[2]);
        const system = parseInt(parts[3]);
        const idle = parseInt(parts[4]);
        const total = user + nice + system + idle;
        
        return {
          user,
          nice,
          system,
          idle,
          total,
          used: user + nice + system
        };
      }
    } catch (error) {
      // Fall back to basic method
    }
    
    return this.captureFallbackCpu();
  }

  private async captureWindowsCpu(): Promise<any> {
    try {
      const { stdout } = await execAsync('wmic cpu get loadpercentage /value');
      const match = stdout.match(/LoadPercentage=(\d+)/);
      
      if (match) {
        const loadPercentage = parseInt(match[1]);
        return {
          loadPercentage,
          used: loadPercentage,
          idle: 100 - loadPercentage,
          total: 100
        };
      }
    } catch (error) {
      // Fall back to basic method
    }
    
    return this.captureFallbackCpu();
  }

  private captureFallbackCpu(): any {
    // Basic CPU capture that works on all platforms
    // This is less accurate but provides a baseline
    const startUsage = process.cpuUsage();
    
    return {
      startUsage,
      timestamp: Date.now()
    };
  }

  private async getSystemInfo(): Promise<any> {
    try {
      const platform = process.platform;
      const arch = process.arch;
      const nodeVersion = process.version;
      const cpus = require('os').cpus().length;
      
      let systemDetails = {};
      
      if (platform === 'darwin') {
        systemDetails = await this.getDarwinSystemInfo();
      } else if (platform === 'linux') {
        systemDetails = await this.getLinuxSystemInfo();
      } else if (platform === 'win32') {
        systemDetails = await this.getWindowsSystemInfo();
      }
      
      return {
        platform,
        arch,
        nodeVersion,
        cpus,
        ...systemDetails
      };
    } catch (error) {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpus: require('os').cpus().length,
        error: 'Failed to get detailed system info'
      };
    }
  }

  private async getDarwinSystemInfo(): Promise<any> {
    try {
      const [memoryResult, cpuResult] = await Promise.all([
        execAsync('sysctl -n hw.memsize'),
        execAsync('sysctl -n hw.ncpu')
      ]);
      
      const totalMemory = parseInt(memoryResult.stdout.trim());
      const cpuCount = parseInt(cpuResult.stdout.trim());
      
      return {
        totalMemory,
        cpuCount,
        os: 'macOS'
      };
    } catch (error) {
      return { os: 'macOS' };
    }
  }

  private async getLinuxSystemInfo(): Promise<any> {
    try {
      const [memoryResult, cpuResult] = await Promise.all([
        execAsync('free -b | grep Mem'),
        execAsync('nproc')
      ]);
      
      const memoryMatch = memoryResult.stdout.match(/\s+(\d+)/);
      const totalMemory = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      const cpuCount = parseInt(cpuResult.stdout.trim());
      
      return {
        totalMemory,
        cpuCount,
        os: 'Linux'
      };
    } catch (error) {
      return { os: 'Linux' };
    }
  }

  private async getWindowsSystemInfo(): Promise<any> {
    try {
      const [memoryResult, cpuResult] = await Promise.all([
        execAsync('wmic computersystem get TotalPhysicalMemory /value'),
        execAsync('wmic cpu get NumberOfCores /value')
      ]);
      
      const memoryMatch = memoryResult.stdout.match(/TotalPhysicalMemory=(\d+)/);
      const totalMemory = memoryMatch ? parseInt(memoryMatch[1]) : 0;
      const cpuMatch = cpuResult.stdout.match(/NumberOfCores=(\d+)/);
      const cpuCount = cpuMatch ? parseInt(cpuMatch[1]) : 0;
      
      return {
        totalMemory,
        cpuCount,
        os: 'Windows'
      };
    } catch (error) {
      return { os: 'Windows' };
    }
  }

  getCurrentMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  getUptime(): number {
    return process.uptime();
  }
}
