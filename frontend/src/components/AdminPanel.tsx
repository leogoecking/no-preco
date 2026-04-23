import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { api } from '@/api/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const STORAGE_KEY = 'admin_token'

function formatDuracao(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}min`
}

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminPanel() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [produtoColeta, setProdutoColeta] = useState('')
  const queryClient = useQueryClient()

  const salvarToken = (t: string) => {
    localStorage.setItem(STORAGE_KEY, t)
    setToken(t)
  }

  const limparToken = () => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
  }

  const {
    mutate: logar,
    isPending: logando,
    error: erroLogin,
    reset: resetLogin,
  } = useMutation({
    mutationFn: () => api.login(usuario, senha),
    onSuccess: (data) => {
      salvarToken(data.token)
      setUsuario('')
      setSenha('')
    },
  })

  const { data: status, isFetching: fetchingStatus } = useQuery({
    queryKey: ['coleta', 'status'],
    queryFn: () => api.coletaStatus(),
    enabled: open && !!token,
    refetchInterval: (query) => (query.state.data?.emExecucao ? 3000 : false),
  })

  const {
    mutate: disparar,
    isPending: disparando,
    isSuccess: disparadoOk,
    error: erroDisparar,
    reset: resetDisparar,
  } = useMutation({
    mutationFn: () => api.coletaDisparar(token!, produtoColeta.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coleta', 'status'] })
      setProdutoColeta('')
    },
    onError: (err) => {
      if (/inválido|expirado|fornecido/i.test(err.message)) limparToken()
    },
  })

  function handleOpen(v: boolean) {
    setOpen(v)
    if (!v) {
      resetLogin()
      resetDisparar()
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-600">
          <Settings className="h-4 w-4" />
        </Button>
      </SheetTrigger>

      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{token ? 'Painel Admin' : 'Acesso Admin'}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-6 pb-6">
          {!token ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                logar()
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Usuário</label>
                <Input
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">Senha</label>
                <Input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {erroLogin && <p className="text-sm text-red-600">{erroLogin.message}</p>}
              <Button type="submit" disabled={logando || !usuario || !senha}>
                {logando ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Status da coleta</h3>
                  <div
                    className={`flex items-center gap-1.5 text-xs ${status?.emExecucao ? 'text-green-600' : 'text-gray-400'}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${status?.emExecucao ? 'animate-pulse bg-green-500' : 'bg-gray-300'}`}
                    />
                    {fetchingStatus && !status ? 'Carregando...' : status?.emExecucao ? 'Em execução' : 'Inativa'}
                  </div>
                </div>

                <p className="text-xs text-gray-500">
                  Município:{' '}
                  <span className="font-medium text-gray-700">
                    {status?.municipioPadrao ?? '—'}
                  </span>
                </p>

                {status?.ultimoRelatorio ? (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
                    <p className="font-medium text-gray-700">Último relatório</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                      <span>Tarefas: {status.ultimoRelatorio.totalTarefas}</span>
                      <span>Salvos: {status.ultimoRelatorio.itensSalvos}</span>
                      <span className="text-green-600">
                        Sucessos: {status.ultimoRelatorio.sucessos}
                      </span>
                      <span className="text-red-500">
                        Falhas: {status.ultimoRelatorio.falhas}
                      </span>
                      {status.ultimoRelatorio.semResultados > 0 && (
                        <span>Sem resultado: {status.ultimoRelatorio.semResultados}</span>
                      )}
                      {status.ultimoRelatorio.duracaoMs != null && (
                        <span>Duração: {formatDuracao(status.ultimoRelatorio.duracaoMs)}</span>
                      )}
                    </div>
                    <p className="text-gray-400">
                      {formatDataHora(status.ultimoRelatorio.iniciadoEm)}
                      {status.ultimoRelatorio.abortado && (
                        <span className="ml-2 text-red-500">· Abortado</span>
                      )}
                    </p>
                  </div>
                ) : (
                  !fetchingStatus && (
                    <p className="text-xs text-gray-400">Nenhuma coleta realizada ainda.</p>
                  )
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-gray-700">Disparar coleta</h3>
                <Input
                  placeholder="Produto específico (vazio = ciclo completo)"
                  value={produtoColeta}
                  onChange={(e) => {
                    setProdutoColeta(e.target.value)
                    resetDisparar()
                  }}
                />
                {erroDisparar && (
                  <p className="text-sm text-red-600">{erroDisparar.message}</p>
                )}
                {disparadoOk && (
                  <p className="text-sm text-green-600">Coleta iniciada em background.</p>
                )}
                <Button
                  onClick={() => disparar()}
                  disabled={disparando || status?.emExecucao}
                >
                  {status?.emExecucao
                    ? 'Coleta em andamento...'
                    : disparando
                      ? 'Disparando...'
                      : produtoColeta.trim()
                        ? `Coletar "${produtoColeta.trim()}"`
                        : 'Disparar ciclo completo'}
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-gray-400"
                onClick={limparToken}
              >
                Sair
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
