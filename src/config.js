import 'dotenv/config';

export const PORT = Number(process.env.PORT || 3000);
export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);

const providers = ['ECNU / DeepSeek', '阿里云百炼', 'Xiaomi MiMo'];
const defaultModels = ['ecnu-max', 'qwen3.7-plus', 'mimo-v2.5-pro'];

export const agents = providers.map((provider, index) => {
  const slot = index + 1;
  return {
    slot,
    provider,
    baseURL: process.env[`AGENT_${slot}_BASE_URL`],
    apiKey: process.env[`AGENT_${slot}_API_KEY`],
    model: process.env[`AGENT_${slot}_MODEL`] || defaultModels[index],
    enableThinking: process.env[`AGENT_${slot}_ENABLE_THINKING`] !== 'false',
  };
});

function isPlaceholder(value = '') {
  return !value || value.startsWith('YOUR_') || value.includes('HERE');
}

export const demoMode = process.env.DEMO_MODE === 'true'
  || (process.env.DEMO_MODE !== 'false' && agents.some((agent) => isPlaceholder(agent.apiKey)));
