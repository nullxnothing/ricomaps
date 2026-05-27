import { ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'footer' | 'nav' | 'main';
}

export function Container({ children, className = '', as: Tag = 'div' }: ContainerProps) {
  return (
    <Tag className={`max-w-6xl mx-auto px-4 sm:px-6 ${className}`}>
      {children}
    </Tag>
  );
}
