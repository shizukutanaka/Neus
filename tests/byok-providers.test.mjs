// Neus — BYOK provider coverage test (Qwen / Gemma / GLM added 2026-08)
// Verifies the three new providers are wired: config defaults, call fns,
// dispatch branch, and the provider <select> options.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('BYOK provider config (byokDefaults)', () => {
  it('declares qwen with DashScope OpenAI-compatible endpoint', () => {
    expect(html).toContain("qwen:     { model:'qwen-plus',                 endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' }");
  });
  it('declares gemma with Google AI Studio Gemini-compatible endpoint', () => {
    expect(html).toContain("gemma:    { model:'gemma-4-flash',            endpoint:'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent' }");
  });
  it('declares glm with Zhipu OpenAI-compatible endpoint', () => {
    expect(html).toContain("glm:      { model:'glm-4.7-flash',             endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions' }");
  });
  it('declares ollama with local OpenAI-compatible endpoint', () => {
    expect(html).toContain("ollama:   { model:'llama3',                     endpoint:'http://localhost:11434/v1/chat/completions' }");
  });
});

describe('BYOK call functions', () => {
  it('defines callQwen (OpenAI-compatible)', () => {
    expect(html).toContain("async function callQwen(prompt,s){");
  });
  it('defines callGemma (Gemini-compatible)', () => {
    expect(html).toContain("async function callGemma(prompt,s){");
  });
  it('defines callGlm (OpenAI-compatible)', () => {
    expect(html).toContain("async function callGlm(prompt,s){");
  });
  it('defines callOllama (local LLM, OpenAI-compatible)', () => {
    expect(html).toContain("async function callOllama(prompt,s){");
  });
});

describe('BYOK dispatch branch', () => {
  it('routes qwen/gemma/glm to their call fns', () => {
    expect(html).toContain("else if(s.provider==='qwen')text=await callQwen(prompt,apiKey)");
    expect(html).toContain("else if(s.provider==='gemma')text=await callGemma(prompt,apiKey)");
    expect(html).toContain("else if(s.provider==='glm')text=await callGlm(prompt,apiKey)");
  });
  it('routes ollama to callOllama', () => {
    expect(html).toContain("else if(s.provider==='ollama')text=await callOllama(prompt,apiKey)");
  });
});

describe('BYOK provider <select> options', () => {
  it('offers Qwen / Gemma / GLM in the settings dropdown', () => {
    expect(html).toContain('<option value="qwen">Alibaba (Qwen)</option>');
    expect(html).toContain('<option value="gemma">Google (Gemma 4)</option>');
    expect(html).toContain('<option value="glm">Zhipu (GLM)</option>');
  });
  it('offers Local (Ollama) in both settings and onboarding dropdowns', () => {
    expect(html).toContain('<option value="ollama">Local (Ollama)</option>');
    expect(html).toContain('<option value="ollama">Local (Ollama)</option>');
  });
});

describe('BYOK i18n copy mentions new providers', () => {
  it('ja onboard copy lists all seven providers', () => {
    expect(html).toContain("'onboard.byok.desc':'OpenAI/Anthropic/Gemini/Qwen/Gemma/GLM/Ollama(ローカル)のAPIキーを登録すると各Eventを自動要約する。後から設定可。'");
  });
  it('en onboard copy lists all seven providers', () => {
    expect(html).toContain("'onboard.byok.desc':'Enter an API key (OpenAI / Anthropic / Gemini / Qwen / Gemma / GLM / local Ollama) to enable automatic article summaries. Configurable later in Settings.'");
  });
});
