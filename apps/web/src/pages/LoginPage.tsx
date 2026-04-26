import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { loginSchema, type LoginInput } from '@/lib/schemas/auth.schema'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginInput) => {
    try {
      const res = await api.post<{ token: string }>('/auth/login', data)
      login(res.data.token)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao fazer login'
      toast.error(msg)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px] border-hairline shadow-none">
        <CardHeader className="text-center pb-2">
          <div className="font-mono uppercase tracking-[0.2em] text-base font-semibold text-foreground mb-2">
            ETHRA NEXUS
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Console de Orquestração</p>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
                Slug da workspace
              </label>
              <Input {...register('slug')} placeholder="minha-empresa" autoFocus className="font-mono" />
              {errors.slug && <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>}
            </div>
            <div>
              <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
                Senha
              </label>
              <Input {...register('password')} type="password" placeholder="••••••••" className="font-mono" />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full mt-1 font-mono uppercase tracking-[0.12em]" disabled={isSubmitting}>
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
          <p className="text-xs text-center text-muted-foreground mt-4">
            Não tem conta?{' '}
            <Link to="/signup" className="text-primary hover:underline font-medium">
              Criar conta
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
