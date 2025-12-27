import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  isPopupMode?: boolean;
}

export function ThemeToggle({ isPopupMode = false }: ThemeToggleProps) {
  const { setTheme, theme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <Button 
      variant="outline" 
      size={isPopupMode ? "sm" : "icon"}
      onClick={toggleTheme} 
      className={`flex items-center justify-center ${isPopupMode ? '' : 'h-9 w-9'}`}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}