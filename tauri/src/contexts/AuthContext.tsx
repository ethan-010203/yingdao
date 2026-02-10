import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, signInWithUsername, signOut as supabaseSignOut, updateLastLogin, syncBanStatus } from '@/lib/supabase'

type UserRole = 'user' | 'admin'

interface AuthContextType {
    user: User | null
    session: Session | null
    username: string | null
    role: UserRole
    isAdmin: boolean
    loading: boolean
    signIn: (username: string, password: string) => Promise<void>
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
    children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null)
    const [session, setSession] = useState<Session | null>(null)
    const [username, setUsername] = useState<string | null>(null)
    const [role, setRole] = useState<UserRole>('user')
    const [loading, setLoading] = useState(true)

    const isAdmin = role === 'admin'

    useEffect(() => {
        // 获取初始会话
        const initSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession()
                setSession(session)
                setUser(session?.user ?? null)

                // 如果已登录，从 profiles 获取用户名和角色
                if (session?.user) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('username, role')
                        .eq('id', session.user.id)
                        .single()
                    setUsername(profile?.username ?? null)
                    setRole((profile?.role as UserRole) || 'user')
                }
            } catch (error) {
                console.error('获取会话失败:', error)
            } finally {
                setLoading(false)
            }
        }

        initSession()

        // 监听认证状态变化
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                setSession(session)
                setUser(session?.user ?? null)
                if (!session) {
                    setUsername(null)
                    setRole('user')
                }
                setLoading(false)
            }
        )

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const signIn = async (inputUsername: string, password: string) => {
        const data = await signInWithUsername(inputUsername, password)
        setSession(data.session)
        setUser(data.user)
        setUsername(data.username)
        setRole((data.role as UserRole) || 'user')

        // 登录后更新相关信息
        if (data.user?.id) {
            await updateLastLogin(data.user.id)
            await syncBanStatus(data.user.id)
        }
    }

    const signOut = async () => {
        await supabaseSignOut()
        setSession(null)
        setUser(null)
        setUsername(null)
        setRole('user')
    }

    return (
        <AuthContext.Provider value={{ user, session, username, role, isAdmin, loading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
