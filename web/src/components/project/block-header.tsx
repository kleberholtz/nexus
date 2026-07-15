type BlockHeaderProps = {
  title: string;
  description: string;
};

export function BlockHeader({ title, description }: BlockHeaderProps) {
  return (
    <div>
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
