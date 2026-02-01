// exe.dev API client using SSH/SCP

import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface VMInfo {
  name: string;
  status: string;
  sshDest: string;
  image?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// SSH key path for exe.dev
const SSH_KEY = process.env.EXE_SSH_KEY || `${process.env.HOME}/.ssh/id_ed25519_exe`;

/**
 * Execute an SSH command and return the result
 */
function sshExec(host: string, command: string, timeoutMs: number = 60000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const args = [
      '-i', SSH_KEY,
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
      host,
      command
    ];

    let stdout = '';
    let stderr = '';
    
    const proc = spawn('ssh', args, { timeout: timeoutMs });
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

/**
 * Copy a file to the VM using SCP
 */
function scpUpload(localPath: string, host: string, remotePath: string, timeoutMs: number = 120000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const args = [
      '-i', SSH_KEY,
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
      localPath,
      `${host}:${remotePath}`
    ];

    let stderr = '';
    
    const proc = spawn('scp', args, { timeout: timeoutMs });
    
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: '',
        stderr,
      });
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

export class ExeClient {
  // List all VMs
  async list(): Promise<VMInfo[]> {
    const result = await sshExec('exe.dev', 'ls --json');
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list VMs: ${result.stderr}`);
    }
    
    try {
      const data = JSON.parse(result.stdout);
      return (data.vms || []).map((vm: { vm_name: string; status: string; ssh_dest: string; image?: string }) => ({
        name: vm.vm_name,
        status: vm.status,
        sshDest: vm.ssh_dest,
        image: vm.image,
      }));
    } catch {
      return [];
    }
  }

  // Get VM info
  async get(name: string): Promise<VMInfo> {
    const vms = await this.list();
    const vm = vms.find(v => v.name === name);
    if (!vm) {
      throw new Error(`VM ${name} not found`);
    }
    return vm;
  }

  // Create a new VM
  async create(name: string): Promise<VMInfo> {
    const result = await sshExec('exe.dev', `new --name=${name} --json --no-email`, 120000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create VM: ${result.stderr}`);
    }
    
    try {
      const data = JSON.parse(result.stdout);
      return {
        name: data.vm_name || name,
        status: data.status || 'running',
        sshDest: data.ssh_dest || `${name}.exe.xyz`,
      };
    } catch {
      // Fallback if JSON parsing fails
      return {
        name,
        status: 'running',
        sshDest: `${name}.exe.xyz`,
      };
    }
  }

  // Delete a VM
  async destroy(name: string): Promise<void> {
    const result = await sshExec('exe.dev', `rm ${name}`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to delete VM: ${result.stderr}`);
    }
  }

  // Get VM SSH destination
  async getSshDest(name: string): Promise<string> {
    const vm = await this.get(name);
    return vm.sshDest;
  }

  // Execute a command on a VM
  async exec(name: string, command: string, args: string[] = []): Promise<ExecResult> {
    const sshDest = `${name}.exe.xyz`;
    const fullCommand = args.length > 0 
      ? `${command} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
      : command;
    
    return sshExec(sshDest, fullCommand);
  }

  // Execute a shell command (convenience method)
  async execShell(name: string, shellCommand: string): Promise<ExecResult> {
    return this.exec(name, `bash -c '${shellCommand.replace(/'/g, "'\\''")}'`);
  }

  // Write a file to the VM
  async writeFile(name: string, path: string, content: string): Promise<void> {
    const sshDest = `${name}.exe.xyz`;
    
    // Use heredoc for text files
    const result = await sshExec(sshDest, `cat > '${path}' << 'AGENTHQ_EOF'\n${content}\nAGENTHQ_EOF`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${result.stderr}`);
    }
  }

  // Read a file from the VM
  async readFile(name: string, path: string): Promise<string> {
    const result = await this.exec(name, 'cat', [path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }
    return result.stdout;
  }

  // Upload a binary file to the VM using SCP
  async uploadFile(name: string, localPath: string, remotePath: string): Promise<void> {
    const sshDest = `${name}.exe.xyz`;
    
    const result = await scpUpload(localPath, sshDest, remotePath);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to upload file: ${result.stderr}`);
    }
  }

  // Set file permissions
  async chmod(name: string, path: string, mode: number): Promise<void> {
    const modeStr = mode.toString(8);
    const result = await this.exec(name, 'chmod', [modeStr, path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to chmod: ${result.stderr}`);
    }
  }

  // Check if VM exists
  async exists(name: string): Promise<boolean> {
    try {
      await this.get(name);
      return true;
    } catch {
      return false;
    }
  }

  // Wait for VM to be ready
  async waitReady(name: string, timeoutMs: number = 60000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      try {
        // Try to run a simple command
        const result = await this.exec(name, 'true');
        if (result.exitCode === 0) {
          return;
        }
      } catch {
        // Ignore and retry
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`VM ${name} did not become ready within ${timeoutMs}ms`);
  }
}

// Factory function
export function createExeClient(): ExeClient {
  return new ExeClient();
}
