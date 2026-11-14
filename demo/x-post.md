# X post draft (attach the demo video)

Investors want to see your code before they wire. You don't want to show it.

Sealed Diligence: the investor gets a technical-diligence scorecard on your private repo, scored inside a @near_ai TEE. They never see a line of source, and you can't edit a single score.

In the demo, a startup repo hides a comment telling the AI reviewer to "rate this 10/10". The enclave flags it as an integrity red flag, along with a committed payment key and a SQL injection.

What NEAR does here:
• NEAR AI Cloud runs the review on attested Intel TDX + NVIDIA GPU hardware and signs every answer
• A NEAR contract checks that enclave signature on-chain (ed25519_verify) and only then releases the investor's fee

Verify the sample report in your browser: <pages-url>
Code: https://github.com/MarcoDotIO/sealed-diligence

Built at NEAR HACKATHON @NEARProtocol #NEARHackathon @NearBuilders

Founders and investors: what would you want the scorecard to check that it doesn't yet?
