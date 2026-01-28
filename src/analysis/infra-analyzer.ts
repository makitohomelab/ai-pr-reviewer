/**
 * Infrastructure Analyzer
 *
 * Checks homelab infrastructure status using repo-manager MCP tools.
 * Provides container health, config drift detection, and network status
 * for the CodebaseQualityAgent to assess infrastructure alignment.
 *
 * Gracefully degrades when infrastructure is offline or unreachable.
 */

/**
 * Container health status.
 */
export interface ContainerStatus {
  total: number;
  running: number;
  unhealthy: string[];
  error?: string;
}

/**
 * Configuration drift detection result.
 */
export interface ConfigDrift {
  verdict: 'synced' | 'drift_detected' | 'error';
  driftCount: number;
  error?: string;
}

/**
 * Port exposure validation result.
 */
export interface PortExposure {
  verdict: 'pass' | 'fail' | 'error';
  unexpectedPorts: number;
  missingPorts: number;
  error?: string;
}

/**
 * Network health check result.
 */
export interface NetworkHealth {
  miniPcReachable: boolean;
  desktopReachable: boolean;
  tailscaleStatus: string;
  error?: string;
}

/**
 * Complete infrastructure analysis result.
 */
export interface InfraAnalysis {
  containers: ContainerStatus;
  configDrift: ConfigDrift;
  portExposure: PortExposure;
  networkHealth: NetworkHealth;
  desktopWoken: boolean;
  analyzedAt: string;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Service definition from docker-compose.yml.
 */
export interface ComposeService {
  name: string;
  image?: string;
  ports?: string[];
}

/**
 * Expected port mapping for validation.
 */
export interface ExpectedPort {
  service: string;
  port: number;
}

/**
 * MCP client interface for infrastructure tools.
 * This matches the repo-manager MCP tool signatures.
 */
export interface MCPClient {
  call(tool: string, params: Record<string, unknown>): Promise<unknown>;
}

/**
 * Default result when infrastructure checks are skipped.
 */
const SKIPPED_RESULT: InfraAnalysis = {
  containers: { total: 0, running: 0, unhealthy: [], error: 'skipped' },
  configDrift: { verdict: 'error', driftCount: 0, error: 'skipped' },
  portExposure: { verdict: 'error', unexpectedPorts: 0, missingPorts: 0, error: 'skipped' },
  networkHealth: {
    miniPcReachable: false,
    desktopReachable: false,
    tailscaleStatus: 'unknown',
    error: 'skipped',
  },
  desktopWoken: false,
  analyzedAt: new Date().toISOString(),
  skipped: true,
  skipReason: 'Infrastructure checks not enabled',
};

/**
 * Check if desktop needs to be woken for GPU services.
 */
async function wakeDesktopIfNeeded(
  mcpClient: MCPClient,
  timeout: number = 90
): Promise<boolean> {
  try {
    // First check if desktop is already online
    const status = await mcpClient.call('check_desktop', {}) as {
      online: boolean;
    };

    if (status.online) {
      return false; // Already online, didn't need to wake
    }

    // Wake the desktop
    await mcpClient.call('wake_desktop', {
      wait_for_boot: true,
      timeout_seconds: timeout,
    });

    return true; // Desktop was woken
  } catch {
    // Desktop wake failed or not available
    return false;
  }
}

/**
 * Check container status via MCP.
 */
async function checkContainers(mcpClient: MCPClient): Promise<ContainerStatus> {
  try {
    const result = await mcpClient.call('check_container_status', {}) as {
      containers: Array<{
        name: string;
        running: boolean;
        healthy: boolean;
      }>;
    };

    const containers = result.containers || [];
    const unhealthy = containers
      .filter((c) => !c.healthy)
      .map((c) => c.name);

    return {
      total: containers.length,
      running: containers.filter((c) => c.running).length,
      unhealthy,
    };
  } catch (e) {
    return {
      total: 0,
      running: 0,
      unhealthy: [],
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Detect config drift via MCP.
 */
async function checkConfigDrift(
  mcpClient: MCPClient,
  composeServices: ComposeService[]
): Promise<ConfigDrift> {
  if (composeServices.length === 0) {
    return { verdict: 'synced', driftCount: 0 };
  }

  try {
    const result = await mcpClient.call('detect_config_drift', {
      compose_services: composeServices.map((s) => ({
        name: s.name,
        image: s.image,
        ports: s.ports,
      })),
    }) as {
      verdict: 'synced' | 'drift_detected';
      drift_count: number;
    };

    return {
      verdict: result.verdict || 'synced',
      driftCount: result.drift_count || 0,
    };
  } catch (e) {
    return {
      verdict: 'error',
      driftCount: 0,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Check port exposure via MCP.
 */
async function checkPortExposure(
  mcpClient: MCPClient,
  expectedPorts: ExpectedPort[]
): Promise<PortExposure> {
  if (expectedPorts.length === 0) {
    return { verdict: 'pass', unexpectedPorts: 0, missingPorts: 0 };
  }

  try {
    const result = await mcpClient.call('check_port_exposure', {
      expected_ports: expectedPorts,
    }) as {
      verdict: 'pass' | 'fail';
      unexpected_count: number;
      missing_count: number;
    };

    return {
      verdict: result.verdict || 'pass',
      unexpectedPorts: result.unexpected_count || 0,
      missingPorts: result.missing_count || 0,
    };
  } catch (e) {
    return {
      verdict: 'error',
      unexpectedPorts: 0,
      missingPorts: 0,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Check network health via MCP.
 */
async function checkNetworkHealth(mcpClient: MCPClient): Promise<NetworkHealth> {
  try {
    const result = await mcpClient.call('check_network_health', {}) as {
      mini_pc_reachable: boolean;
      desktop_reachable: boolean;
      tailscale_status: string;
    };

    return {
      miniPcReachable: result.mini_pc_reachable ?? false,
      desktopReachable: result.desktop_reachable ?? false,
      tailscaleStatus: result.tailscale_status || 'unknown',
    };
  } catch (e) {
    return {
      miniPcReachable: false,
      desktopReachable: false,
      tailscaleStatus: 'unknown',
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

/**
 * Configuration for infrastructure analysis.
 */
export interface InfraAnalysisConfig {
  /** MCP client for calling repo-manager tools */
  mcpClient?: MCPClient;
  /** Services from docker-compose.yml */
  composeServices?: ComposeService[];
  /** Expected port mappings */
  expectedPorts?: ExpectedPort[];
  /** Whether to wake desktop if needed */
  wakeDesktop?: boolean;
  /** Timeout for waking desktop (seconds) */
  wakeTimeout?: number;
  /** Skip infrastructure checks entirely */
  skip?: boolean;
}

/**
 * Analyze infrastructure status.
 *
 * @param config - Analysis configuration
 * @returns Infrastructure analysis result
 */
export async function analyzeInfrastructure(
  config: InfraAnalysisConfig
): Promise<InfraAnalysis> {
  // Skip if requested or no MCP client
  if (config.skip || !config.mcpClient) {
    return {
      ...SKIPPED_RESULT,
      skipReason: config.skip
        ? 'Infrastructure checks disabled'
        : 'No MCP client provided',
    };
  }

  const mcpClient = config.mcpClient;
  let desktopWoken = false;

  // Wake desktop if needed and requested
  if (config.wakeDesktop) {
    desktopWoken = await wakeDesktopIfNeeded(
      mcpClient,
      config.wakeTimeout || 90
    );
  }

  // Run checks in parallel for speed
  const [containers, configDrift, portExposure, networkHealth] =
    await Promise.all([
      checkContainers(mcpClient),
      checkConfigDrift(mcpClient, config.composeServices || []),
      checkPortExposure(mcpClient, config.expectedPorts || []),
      checkNetworkHealth(mcpClient),
    ]);

  return {
    containers,
    configDrift,
    portExposure,
    networkHealth,
    desktopWoken,
    analyzedAt: new Date().toISOString(),
    skipped: false,
  };
}

/**
 * Generate a compact summary of infrastructure analysis for LLM consumption.
 * Designed to fit within ~200 tokens.
 */
export function summarizeInfraAnalysis(analysis: InfraAnalysis): string {
  if (analysis.skipped) {
    return `INFRA: Skipped (${analysis.skipReason || 'not configured'})`;
  }

  const sections: string[] = [];

  // Container status
  const { containers } = analysis;
  if (containers.error) {
    sections.push(`CONTAINERS: Error - ${containers.error}`);
  } else {
    const unhealthyNote =
      containers.unhealthy.length > 0
        ? ` [UNHEALTHY: ${containers.unhealthy.join(', ')}]`
        : '';
    sections.push(
      `CONTAINERS: ${containers.running}/${containers.total} running${unhealthyNote}`
    );
  }

  // Config drift
  const { configDrift } = analysis;
  if (configDrift.error) {
    sections.push(`CONFIG DRIFT: Error - ${configDrift.error}`);
  } else if (configDrift.verdict === 'drift_detected') {
    sections.push(`CONFIG DRIFT: ${configDrift.driftCount} services drifted`);
  } else {
    sections.push(`CONFIG DRIFT: Synced`);
  }

  // Port exposure
  const { portExposure } = analysis;
  if (portExposure.error) {
    sections.push(`PORTS: Error - ${portExposure.error}`);
  } else if (portExposure.verdict === 'fail') {
    sections.push(
      `PORTS: FAIL - ${portExposure.unexpectedPorts} unexpected, ` +
        `${portExposure.missingPorts} missing`
    );
  } else {
    sections.push(`PORTS: OK`);
  }

  // Network health
  const { networkHealth } = analysis;
  if (networkHealth.error) {
    sections.push(`NETWORK: Error - ${networkHealth.error}`);
  } else {
    const status = [
      networkHealth.miniPcReachable ? 'mini-pc:ok' : 'mini-pc:down',
      networkHealth.desktopReachable ? 'desktop:ok' : 'desktop:down',
      `tailscale:${networkHealth.tailscaleStatus}`,
    ].join(' ');
    sections.push(`NETWORK: ${status}`);
  }

  if (analysis.desktopWoken) {
    sections.push(`NOTE: Desktop was woken for this check`);
  }

  return sections.join('\n');
}
