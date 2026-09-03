import { createContext, useContext, ReactNode } from 'react'

type UserRole = 'user' | 'admin'

interface AuthContextType {
    user: null
    session: null
    username: string
    role: UserRole
    isAdmin: boolean
    loading: boolean
    signIn: (username: string, password: string) => Promise<void>
    signOut: () => Promise<void>
}

const noopAuth: AuthContextType = {
    user: null,
    session: null,
    username: '管理员',
    role: 'admin',
    isAdmin: true,
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
}

const AuthContext = createContext<AuthContextType>(noopAuth)

interface AuthProviderProps {
    children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
    return (
        <AuthContext.Provider value={noopAuth}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    return useContext(AuthContext)
}
