'use client';
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type DrawerRoute = '/payments/new' | '/expenses/new' | null;

interface DrawerCtx {
  activeRoute: DrawerRoute;
  openDrawer:  (route: string) => void;
  closeDrawer: () => void;
}

const DrawerContext = createContext<DrawerCtx>({
  activeRoute: null,
  openDrawer:  () => {},
  closeDrawer: () => {},
});

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [activeRoute, setActiveRoute] = useState<DrawerRoute>(null);

  // Drawer state is independent of route navigation.
  const openDrawer = useCallback((route: string) => {
    setActiveRoute(route as DrawerRoute);
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveRoute(null);
  }, []);

  return (
    <DrawerContext.Provider value={{ activeRoute, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  return useContext(DrawerContext);
}
