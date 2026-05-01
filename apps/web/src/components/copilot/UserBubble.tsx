interface Props {
  text: string
}

export function UserBubble({ text }: Props) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}
