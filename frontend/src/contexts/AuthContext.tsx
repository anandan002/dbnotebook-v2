import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User, AuthState, LoginRequest, ChangePasswordRequest } from '../types/auth';
import { withBasePath } from '../utils/paths';

interface AuthContextType extends AuthState {
  // Actions
  login: (credentials: LoginRequest) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<boolean>;
  regenerateApiKey: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Computed properties
  const isAuthenticated = user !== null;
  const isAdmin = user?.roles?.includes('admin') ?? false;

  // Check current user session on mount
  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(withBasePath('/api/auth/me'), {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success && data.authenticated && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Error checking auth status:', err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Login
  const login = useCallback(async (credentials: LoginRequest): Promise<boolean> => {
    setIsLoading(true);
    try {
      const response = await fetch(withBasePath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success && data.user) {
        setUser(data.user);
        return true;
      }

      return false;
    } catch (err) {
      console.error('Login error:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await fetch(withBasePath('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
    }
  }, []);

  // Change password
  const changePassword = useCallback(async (request: ChangePasswordRequest): Promise<boolean> => {
    try {
      const response = await fetch(withBasePath('/api/auth/password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        credentials: 'include',
      });

      const data = await response.json();
      return data.success;
    } catch (err) {
      console.error('Change password error:', err);
      return false;
    }
  }, []);

  // Regenerate API key
  const regenerateApiKey = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(withBasePath('/api/auth/api-key'), {
        method: 'POST',
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success && data.api_key) {
        // Update local user state
        setUser((prev) => prev ? { ...prev, api_key: data.api_key } : null);
        return data.api_key;
      }

      return null;
    } catch (err) {
      console.error('Regenerate API key error:', err);
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isAdmin,
        isLoading,
        login,
        logout,
        refreshUser,
        changePassword,
        regenerateApiKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
