// Domain failures shared by the app confirmation and direct MCP execution.
export const operationErrors = {
  PT409: [409, 'O Item mudou desde a proposta. Consulte novamente e solicite uma nova proposta.'],
  PT410: [410, 'Proposta expirada sem gravação. Solicite uma nova proposta.'],
  '23505': [409, 'Já existe um Item com esse nome. Consulte o Item existente ou solicite outra proposta com um nome diferente.'],
  '22003': [422, 'A quantidade final excede o limite permitido. Consulte o saldo e solicite outra proposta com uma quantidade menor.'],
  '23503': [422, 'A categoria ou o Item não está mais disponível. Consulte novamente e solicite outra proposta.'],
  '23502': [422, 'Faltam dados obrigatórios. Corrija o pedido e solicite outra proposta.'],
  '23514': [422, 'Os dados violam as regras do inventário. Corrija o pedido e solicite outra proposta.'],
  '22023': [422, 'A operação ou o Item não é válido. Consulte novamente e solicite outra proposta.'],
  '22P02': [422, 'Os dados da operação não são válidos. Corrija o pedido e solicite outra proposta.'],
  '42501': [403, 'Acesso ao inventário não liberado. Entre novamente antes de solicitar outra proposta.'],
};
