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
      size="sm"
      onClick={toggleTheme} 
      className={`flex items-center justify-center ${isPopupMode ? 'h-7 w-7 p-0' : ''}`}
    >
      <Sun className={`rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 ${isPopupMode ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
      <Moon className={`absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 ${isPopupMode ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}