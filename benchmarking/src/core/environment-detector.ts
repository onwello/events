import { EnvironmentInfo } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class EnvironmentDetector {
  async detect(): Promise<EnvironmentInfo> {
    const [nodeVersion, platform, arch, cpus, memory, gitInfo] = await Promise.all([
      this.getNodeVersion(),
      this.getPlatform(),
      this.getArchitecture(),
      this.getCpuCount(),
      this.getMemoryInfo(),
      this.getGitInfo()
    ]);

    return {
      nodeVersion,
      platform,
      arch,
      cpus,
      memory,
      timestamp: new Date().toISOString(),
      gitCommit: gitInfo.commit,
      gitBranch: gitInfo.branch
    };
  }

  private async getNodeVersion(): Promise<string> {
    return process.version;
  }

  private async getPlatform(): Promise<string> {
    return process.platform;
  }

  private async getArchitecture(): Promise<string> {
    return process.arch;
  }

  private async getCpuCount(): Promise<number> {
    const os = require('os');
    return os.cpus().length;
  }

  private async getMemoryInfo(): Promise<{ total: number; free: number }> {
    const os = require('os');
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    return {
      total: totalMemory,
      free: freeMemory
    };
  }

  private async getGitInfo(): Promise<{ commit?: string; branch?: string }> {
    try {
      const [commitResult, branchResult] = await Promise.all([
        execAsync('git rev-parse HEAD'),
        execAsync('git rev-parse --abbrev-ref HEAD')
      ]);
      
      return {
        commit: commitResult.stdout.trim(),
        branch: branchResult.stdout.trim()
      };
    } catch (error) {
      // Git info not available (not a git repo or git not installed)
      return {};
    }
  }

  async getDetailedSystemInfo(): Promise<any> {
    const basicInfo = await this.detect();
    
    try {
      const [osInfo, networkInfo, diskInfo] = await Promise.all([
        this.getOperatingSystemInfo(),
        this.getNetworkInfo(),
        this.getDiskInfo()
      ]);
      
      return {
        ...basicInfo,
        os: osInfo,
        network: networkInfo,
        disk: diskInfo
      };
    } catch (error) {
      return basicInfo;
    }
  }

  private async getOperatingSystemInfo(): Promise<any> {
    try {
      if (process.platform === 'darwin') {
        return await this.getDarwinOSInfo();
      } else if (process.platform === 'linux') {
        return await this.getLinuxOSInfo();
      } else if (process.platform === 'win32') {
        return await this.getWindowsOSInfo();
      } else {
        return { platform: process.platform };
      }
    } catch (error) {
      return { platform: process.platform, error: 'Failed to get OS info' };
    }
  }

  private async getDarwinOSInfo(): Promise<any> {
    try {
      const [versionResult, buildResult] = await Promise.all([
        execAsync('sw_vers -productVersion'),
        execAsync('sw_vers -buildVersion')
      ]);
      
      return {
        platform: 'macOS',
        version: versionResult.stdout.trim(),
        build: buildResult.stdout.trim()
      };
    } catch (error) {
      return { platform: 'macOS' };
    }
  }

  private async getLinuxOSInfo(): Promise<any> {
    try {
      const [osReleaseResult, kernelResult] = await Promise.all([
        execAsync('cat /etc/os-release | grep PRETTY_NAME'),
        execAsync('uname -r')
      ]);
      
      const osMatch = osReleaseResult.stdout.match(/PRETTY_NAME="(.+)"/);
      const osName = osMatch ? osMatch[1] : 'Unknown Linux';
      
      return {
        platform: 'Linux',
        distribution: osName,
        kernel: kernelResult.stdout.trim()
      };
    } catch (error) {
      return { platform: 'Linux' };
    }
  }

  private async getWindowsOSInfo(): Promise<any> {
    try {
      const [versionResult, buildResult] = await Promise.all([
        execAsync('ver'),
        execAsync('wmic os get BuildNumber /value')
      ]);
      
      const buildMatch = buildResult.stdout.match(/BuildNumber=(\d+)/);
      const buildNumber = buildMatch ? buildMatch[1] : 'Unknown';
      
      return {
        platform: 'Windows',
        version: versionResult.stdout.trim(),
        build: buildNumber
      };
    } catch (error) {
      return { platform: 'Windows' };
    }
  }

  private async getNetworkInfo(): Promise<any> {
    try {
      if (process.platform === 'darwin') {
        return await this.getDarwinNetworkInfo();
      } else if (process.platform === 'linux') {
        return await this.getLinuxNetworkInfo();
      } else {
        return {};
      }
    } catch (error) {
      return {};
    }
  }

  private async getDarwinNetworkInfo(): Promise<any> {
    try {
      const { stdout } = await execAsync('ifconfig | grep "inet " | grep -v 127.0.0.1');
      const ips = stdout.split('\n')
        .filter(line => line.trim())
        .map(line => line.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1])
        .filter(ip => ip);
      
      return { localIPs: ips };
    } catch (error) {
      return {};
    }
  }

  private async getLinuxNetworkInfo(): Promise<any> {
    try {
      const { stdout } = await execAsync('hostname -I');
      const ips = stdout.trim().split(/\s+/).filter(ip => ip);
      
      return { localIPs: ips };
    } catch (error) {
      return {};
    }
  }

  private async getDiskInfo(): Promise<any> {
    try {
      if (process.platform === 'darwin') {
        return await this.getDarwinDiskInfo();
      } else if (process.platform === 'linux') {
        return await this.getLinuxDiskInfo();
      } else {
        return {};
      }
    } catch (error) {
      return {};
    }
  }

  private async getDarwinDiskInfo(): Promise<any> {
    try {
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      
      if (parts.length >= 5) {
        return {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usage: parts[4]
        };
      }
      
      return {};
    } catch (error) {
      return {};
    }
  }

  private async getLinuxDiskInfo(): Promise<any> {
    try {
      const { stdout } = await execAsync('df -h / | tail -1');
      const parts = stdout.trim().split(/\s+/);
      
      if (parts.length >= 5) {
        return {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usage: parts[4]
        };
      }
      
      return {};
    } catch (error) {
      return {};
    }
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    const relevantVars = [
      'NODE_ENV',
      'NODE_OPTIONS',
      'UV_THREADPOOL_SIZE',
      'GC_INTERVAL',
      'REDIS_URL',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
      'REDIS_DB'
    ];
    
    const env: Record<string, string> = {};
    
    for (const varName of relevantVars) {
      if (process.env[varName]) {
        env[varName] = process.env[varName]!;
      }
    }
    
    return env;
  }

  async getProcessInfo(): Promise<any> {
    return {
      pid: process.pid,
      ppid: process.ppid,
      uid: process.getuid ? process.getuid() : undefined,
      gid: process.getgid ? process.getgid() : undefined,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv,
      env: await this.getEnvironmentVariables()
    };
  }
}
