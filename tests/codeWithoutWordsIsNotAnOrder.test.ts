// failedbr #1278 (2026-11-20): raw Unity C# pasted into a Quran reader with no words. The engine invented "add a Settings
// feature" (from the script's own [Header("Bike Settings")]), called it a large high-risk change and edited the wrong app.
import { describe, expect, it } from 'vitest';
import { buildConfirmation, buildConfirmationApplies, isCodeWithoutInstruction } from '../src/server/AgentV3/buildConfirmation';

const UNITY = `using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class BikeController : MonoBehaviour
{
    [Header("Bike Settings")]
    public float maxSpeed = 40f;
    public float acceleration = 12f;
    private Rigidbody rb;

    void Start()
    {
        rb = GetComponent<Rigidbody>();
    }

    void FixedUpdate()
    {
        float v = Input.GetAxis("Vertical");
        rb.AddForce(transform.forward * v * acceleration);
    }
}`;
const PAGE = `<!DOCTYPE html>
<html>
<head><title>My Bill Maker</title></head>
<body>
<button>Save</button>
</body>
</html>`;

describe('code with no words is not an order (failedbr #1278)', () => {
  it('the reported paste is answered, never built — even in a workspace that already has an app', () => {
    expect(isCodeWithoutInstruction(UNITY)).toBe(true);
    expect(buildConfirmation(UNITY)).toEqual({ confirmed: false, reason: 'code-without-instruction' });
    expect(buildConfirmationApplies('edit_existing', true, UNITY)).toBe(true);
  });
  it('code WITH an instruction still builds, and a whole pasted page is still the user\'s app', () => {
    const withWords = `${UNITY}\n\nconvert this bike controller into a web game`;
    expect(isCodeWithoutInstruction(withWords)).toBe(false);
    expect(buildConfirmation(withWords).confirmed).toBe(true);
    expect(isCodeWithoutInstruction(PAGE)).toBe(false);
  });
  it('an ordinary edit on an existing app is not re-asked', () => {
    expect(buildConfirmationApplies('edit_existing', true, 'make the header blue')).toBe(false);
    expect(buildConfirmationApplies('edit_existing', false, 'make the header blue')).toBe(true);
    expect(buildConfirmationApplies('new_build', true, 'todo app')).toBe(true);
    expect(buildConfirmationApplies('chat', false, 'hi')).toBe(false);
  });
});
