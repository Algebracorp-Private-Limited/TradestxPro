"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [market, setMarket] = useState<any>(null);

  useEffect(() => {
    fetch("http://localhost:5000/api/market/nse")
      .then((res) => res.json())
      .then((data) => setMarket(data));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <h1 className="text-4xl font-bold mb-6">TradeStxPro</h1>

      {market ? (
        <div className="bg-gray-900 p-6 rounded-xl shadow-lg">
          <h2 className="text-2xl mb-2">{market.index}</h2>
          <p>Level: {market.level}</p>
          <p className="text-green-400">
            Change: {market.change} ({market.percent}%)
          </p>
        </div>
      ) : (
        <p>Loading market data...</p>
      )}
    </div>
  );
}