import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { AlertasPreco } from '@/components/AlertasPreco'
import { BuscaProduto } from '@/components/BuscaProduto'
import { CarrinhoSheet } from '@/components/CarrinhoSheet'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900">no preço</h1>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <MapPin className="h-3 w-3" />
                Teixeira de Freitas
              </div>
            </div>
            <CarrinhoSheet />
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-4 py-6">
          <AlertasPreco />
          <BuscaProduto />
        </main>
      </div>
    </QueryClientProvider>
  )
}
