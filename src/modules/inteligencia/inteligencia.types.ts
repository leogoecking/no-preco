// ─────────────────────────────────────────────
// Parâmetros de entrada
// ─────────────────────────────────────────────

export interface FiltroBase {
  municipio?: string;
  /** Produtos específicos; se omitido, retorna todos */
  produtos?: string[];
}

export interface FiltroEstatisticas extends FiltroBase {
  /** Janela de análise em dias (padrão 7) */
  dias?: number;
}

export interface FiltroVolatilidade extends FiltroBase {
  /** Janela de análise em dias (padrão 30) */
  dias?: number;
  /** Máximo de produtos no ranking (padrão 20) */
  limite?: number;
  /** Amostras mínimas para entrar no ranking (padrão 5) */
  minimoAmostras?: number;
}

export interface FiltroAlertas extends FiltroBase {
  /**
   * Limiar de queda vs média 6m para gerar alerta (padrão -5).
   * Ex: -5 significa "preço atual está ≥ 5% abaixo da média dos 6 meses".
   */
  variacaoLimiar?: number;
}

// ─────────────────────────────────────────────
// Estatísticas semanais por produto
// ─────────────────────────────────────────────

export interface EstatisticaProduto {
  produto: string;
  /** Preço da coleta mais recente na janela */
  precoAtual: number;
  /** Mercado onde o preço atual foi coletado */
  mercadoAtual: string;
  precoMin: number;
  precoMax: number;
  precoMedio: number;
  /** Diferença absoluta entre máximo e mínimo */
  amplitudeAbsoluta: number;
  /**
   * Variação percentual do preço atual em relação à média do período.
   * Positivo → preço subiu vs média. Negativo → preço caiu vs média.
   */
  variacaoVsMedia: number;
  totalAmostras: number;
  ultimaColeta: Date;
}

export interface ResultadoEstatisticas {
  geradoEm: string;
  janelaEmDias: number;
  municipio?: string;
  totalProdutos: number;
  produtos: EstatisticaProduto[];
}

// ─────────────────────────────────────────────
// Ranking de volatilidade
// ─────────────────────────────────────────────

export type NivelVolatilidade = 'ESTÁVEL' | 'MODERADO' | 'VOLÁTIL' | 'MUITO_VOLÁTIL';

export interface ProdutoVolatilidade {
  posicao: number;
  produto: string;
  precoMin: number;
  precoMax: number;
  precoMedio: number;
  /**
   * Desvio padrão amostral calculado pelo MongoDB ($stdDevSamp).
   * Mede a dispersão absoluta dos preços.
   */
  desvioPadrao: number;
  /**
   * Coeficiente de variação (CV) = desvioPadrao / precoMedio × 100.
   * Métrica adimensional — permite comparar produtos de preços diferentes.
   * CV < 5%: estável | 5-15%: moderado | 15-30%: volátil | > 30%: muito volátil
   */
  coeficienteVariacao: number;
  /** Amplitude percentual = (precoMax - precoMin) / precoMedio × 100 */
  amplitudePercent: number;
  nivel: NivelVolatilidade;
  totalAmostras: number;
}

export interface ResultadoVolatilidade {
  geradoEm: string;
  janelaEmDias: number;
  municipio?: string;
  minimoAmostras: number;
  totalProdutosAnalisados: number;
  ranking: ProdutoVolatilidade[];
}

// ─────────────────────────────────────────────
// Alertas de mínimo histórico (6 meses)
// ─────────────────────────────────────────────

export interface AlertaPreco {
  produto: string;
  precoAtual: number;
  mercadoAtual: string;
  dataUltimaColeta: Date;
  mediaHistorica6m: number;
  minHistorico6m: number;
  maxHistorico6m: number;
  /**
   * Variação do preço atual vs média dos 6 meses.
   * Negativo = preço atual está ABAIXO da média (oportunidade de compra).
   */
  variacaoVsMedia6m: number;
  /**
   * true quando o preço atual está dentro de 5% do mínimo histórico.
   * Indica que é um dos menores preços já registrados.
   */
  ehMinimoHistorico: boolean;
  totalAmostras6m: number;
}

export interface ResultadoAlertas {
  geradoEm: string;
  municipio?: string;
  variacaoLimiar: number;
  totalAlertas: number;
  alertas: AlertaPreco[];
}
