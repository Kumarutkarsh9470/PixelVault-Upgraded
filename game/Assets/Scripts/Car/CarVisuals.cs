using UnityEngine;

/// The cosmetic layer of a car: chassis model, underglow and light trails.
/// These are exactly the things players craft as backed items, and none of
/// them affect handling.
public class CarVisuals : MonoBehaviour
{
    public const float CarLength = 3.8f;

    GameObject model;
    GameObject underglow;
    TrailRenderer[] trails = new TrailRenderer[0];
    string currentChassis;

    public Vector3 ModelSize { get; private set; } = new Vector3(1.9f, 1.1f, CarLength);

    public void Apply(LoadoutPayload loadout)
    {
        loadout ??= new LoadoutPayload();
        SetChassis(string.IsNullOrEmpty(loadout.chassis) ? "race" : loadout.chassis);
        SetUnderglow(loadout.underglow);
        SetTrail(loadout.trail);
    }

    public void SetChassis(string chassis)
    {
        if (chassis == currentChassis && model != null)
        {
            return;
        }
        if (model != null)
        {
            Destroy(model);
        }
        currentChassis = chassis;

        model = Props.Spawn("CarKit/" + chassis, transform, CarLength, Props.Axis.Z);
        model.transform.localRotation = Quaternion.identity;
        model.transform.localPosition = Vector3.zero;
        foreach (var c in model.GetComponentsInChildren<Collider>())
        {
            Destroy(c);
        }

        // Sit the model on the car's origin and size the physics box to it.
        Bounds bounds = Props.MeshBounds(model);
        Vector3 local = transform.InverseTransformPoint(bounds.center);
        model.transform.localPosition = new Vector3(-local.x, -transform.InverseTransformPoint(bounds.min).y, -local.z);
        ModelSize = bounds.size;

        var box = GetComponent<BoxCollider>();
        if (box != null)
        {
            box.size = new Vector3(ModelSize.x * 0.9f, ModelSize.y * 0.7f, ModelSize.z * 0.95f);
            box.center = new Vector3(0f, ModelSize.y * 0.4f, 0f);
        }
        PositionTrails();
    }

    public void SetUnderglow(string hex)
    {
        if (underglow != null)
        {
            Destroy(underglow);
            underglow = null;
        }
        if (string.IsNullOrEmpty(hex))
        {
            return;
        }

        underglow = GameObject.CreatePrimitive(PrimitiveType.Quad);
        underglow.name = "Underglow";
        Destroy(underglow.GetComponent<Collider>());
        underglow.transform.SetParent(transform, false);
        underglow.transform.localPosition = new Vector3(0f, 0.06f, 0f);
        underglow.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        underglow.transform.localScale = new Vector3(ModelSize.x * 1.5f, ModelSize.z * 1.25f, 1f);
        underglow.GetComponent<Renderer>().sharedMaterial = Mats.Glow(Palette.Parse(hex, Color.cyan), 3f);
    }

    public void SetTrail(string hex)
    {
        foreach (var t in trails)
        {
            if (t != null)
            {
                Destroy(t.gameObject);
            }
        }
        trails = new TrailRenderer[0];
        if (string.IsNullOrEmpty(hex))
        {
            return;
        }

        Color color = Palette.Parse(hex, Color.magenta);
        trails = new TrailRenderer[2];
        for (int i = 0; i < 2; i++)
        {
            var go = new GameObject(i == 0 ? "Trail L" : "Trail R");
            go.transform.SetParent(transform, false);
            var trail = go.AddComponent<TrailRenderer>();
            trail.time = 0.45f;
            trail.minVertexDistance = 0.3f;
            trail.widthCurve = AnimationCurve.EaseInOut(0f, 0.35f, 1f, 0f);
            trail.sharedMaterial = Mats.Trail(color);
            trail.startColor = color;
            trail.endColor = new Color(color.r, color.g, color.b, 0f);
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            trails[i] = trail;
        }
        PositionTrails();
    }

    void PositionTrails()
    {
        for (int i = 0; i < trails.Length; i++)
        {
            if (trails[i] == null)
            {
                continue;
            }
            float side = i == 0 ? -1f : 1f;
            trails[i].transform.localPosition = new Vector3(side * ModelSize.x * 0.38f, 0.35f, -ModelSize.z * 0.48f);
            trails[i].Clear();
        }
    }

    public void ClearTrails()
    {
        foreach (var t in trails)
        {
            if (t != null)
            {
                t.Clear();
            }
        }
    }
}
