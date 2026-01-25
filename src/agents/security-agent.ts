/**
 * Security Agent
 *
 * Specialized agent for detecting security vulnerabilities:
 * - Injection attacks (SQL, command, XSS)
 * - Authentication/authorization bypass
 * - Secrets exposure
 * - Unsafe deserialization
 * - CSRF vulnerabilities
 */

import type { ModelProvider } from '../lib/model-provider.js';
import type { BaseContext, PRDelta } from '../context/index.js';
import {
  BaseAgent,
  BASE_RESPONSE_SCHEMA,
  parseCommonResponse,
  type AgentConfig,
  type AgentInput,
  type AgentFinding,
} from './base-agent.js';

const SECURITY_CONFIG: AgentConfig = {
  name: 'security',
  capability: 'security',
  tokenBudget: 16384,
  priority: 1, // Runs first
};

/**
 * Security-focused code review agent.
 */
export class SecurityAgent extends BaseAgent {
  constructor(provider: ModelProvider) {
    super(provider, SECURITY_CONFIG);
  }

  protected buildSystemPrompt(context: BaseContext, delta: PRDelta): string {
    const sections: string[] = [];

    // Base security instructions
    sections.push(`You are a security-focused code reviewer. Analyze the diff for security vulnerabilities.

FOCUS AREAS:
1. **Injection**: SQL injection, command injection, XSS, template injection
2. **Auth Bypass**: Authentication/authorization flaws, privilege escalation
3. **Secrets**: Hardcoded credentials, API keys, tokens in code
4. **Deserialization**: Unsafe JSON/object parsing, prototype pollution
5. **CSRF/SSRF**: Cross-site request forgery, server-side request forgery

SEVERITY GUIDE:
- critical: Direct security exploit, data breach risk, auth bypass
- high: Potential vulnerability requiring specific conditions
- medium: Security smell, missing validation, weak patterns

RULES:
- Only report actual vulnerabilities, not style issues
- Include file path and line number when possible
- Provide specific remediation suggestions
- Max 5 findings, most severe first`);

    // Add repo-specific security context if available
    if (context.qwenPrompts.securityPreamble) {
      sections.push(`\nREPO-SPECIFIC SECURITY PATTERNS:\n${context.qwenPrompts.securityPreamble}`);
    }

    // Add risk factors from delta
    const securityRisks = delta.riskFactors.filter((r) => r.type === 'security');
    if (securityRisks.length > 0) {
      const riskLines = securityRisks.map((r) => `- ${r.description}`);
      sections.push(`\nIDENTIFIED RISK AREAS:\n${riskLines.join('\n')}`);
    }

    // Add relevant patterns
    const securityPatterns = delta.changedPatterns.filter(
      (p) => p.type === 'security' || p.type === 'anti-pattern'
    );
    if (securityPatterns.length > 0) {
      const patternLines = securityPatterns
        .slice(0, 3)
        .map((p) => `- ${p.id}: ${p.description}`);
      sections.push(`\nPATTERNS TO CHECK:\n${patternLines.join('\n')}`);
    }

    return sections.join('\n');
  }

  protected getResponseSchema(): Record<string, unknown> {
    return {
      ...BASE_RESPONSE_SCHEMA,
      properties: {
        ...BASE_RESPONSE_SCHEMA.properties,
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['critical', 'high', 'medium'] },
              category: {
                type: 'string',
                enum: ['injection', 'auth', 'secrets', 'deserialization', 'csrf', 'other'],
              },
              file: { type: 'string' },
              line: { type: 'integer' },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['priority', 'category', 'message'],
          },
        },
      },
    };
  }

  protected parseResponse(
    response: string,
    _input: AgentInput
  ): { findings: AgentFinding[]; summary: string; confidence: number } {
    return parseCommonResponse(response, this.config.name);
  }
}

/**
 * Create a security agent instance.
 */
export function createSecurityAgent(provider: ModelProvider): SecurityAgent {
  return new SecurityAgent(provider);
}
