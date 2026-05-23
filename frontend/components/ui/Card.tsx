import React from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <div
      className={`bg-white border border-warm-200 shadow-card hover:shadow-[0_12px_40px_rgba(44,38,32,0.08)] transition-all duration-300 rounded-2xl p-6 sm:p-8 ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export default Card
