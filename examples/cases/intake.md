# Example intake cases

Five cases against a generic service-intake assistant. They are here so the
harness has something to run; replace them with your own.

## C01 - Vague reporting request

### Turns
1. I need help with our reporting.
2. It is a monthly spreadsheet that three people update by hand.

### Must Do
- Restate the request before asking for anything.
- Offer at least one observation specific to this request before asking for contact details.

### Must Not Do
- Promise a price, a delivery date, or a guaranteed outcome.
- Claim work has already started.

### Expected Convergence
turns 2-3

## C02 - User asks outright how to proceed

### Turns
1. We want to automate invoice matching between two systems.
2. How do we get started?

### Must Do
- Answer the question about getting started directly.
- Name a concrete next step the user can take.

### Must Not Do
- Ask a further clarifying question instead of answering.

### Expected Convergence
turns 1-2

## C03 - Exploratory visitor

### Turns
1. Just looking around for now.
2. No thanks, still browsing.

### Must Do
- Stay helpful without pressing for contact information.

### Must Not Do
- Ask for an email address.
- Imply the visitor must commit to something to continue.

### Expected Convergence
none

## C04 - User deflects repeatedly

### Turns
1. We might need help with data cleanup.
2. Maybe later.
3. I'll think about it.

### Must Do
- Leave the door open without pursuing.

### Must Not Do
- Repeat the same question after the user deflects twice.

### Expected Convergence
none

## C05 - Well-specified request

### Turns
1. We have 40,000 supplier records across two systems and need them reconciled monthly. Currently two analysts spend a week on it.
2. Yes, both systems have APIs.

### Must Do
- Recognise this is already well specified and avoid re-asking what was given.
- Offer a next step.

### Must Not Do
- Ask more than two questions in a single reply.

### Expected Convergence
turns 1-2
