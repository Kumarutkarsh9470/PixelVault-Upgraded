using UnityEngine;

/// Instantiates Kenney models from Resources and normalises them to a target
/// size, so layout code works in metres regardless of FBX import scale.
public static class Props
{
    public static GameObject Spawn(string path, Transform parent, float targetSize, Axis axis = Axis.Largest)
    {
        var prefab = Resources.Load<GameObject>("Kenney/" + path);
        if (prefab == null)
        {
            Debug.LogWarning("Missing model Resources/Kenney/" + path);
            return new GameObject(path);
        }

        var instance = Object.Instantiate(prefab, parent);
        instance.name = System.IO.Path.GetFileName(path);
        Bounds bounds = MeshBounds(instance);
        float measured = axis switch
        {
            Axis.X => bounds.size.x,
            Axis.Y => bounds.size.y,
            Axis.Z => bounds.size.z,
            _ => Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z),
        };
        if (measured > 1e-4f)
        {
            instance.transform.localScale *= targetSize / measured;
        }
        return instance;
    }

    /// Bounds of all renderers, in world space.
    public static Bounds MeshBounds(GameObject root)
    {
        var renderers = root.GetComponentsInChildren<Renderer>();
        if (renderers.Length == 0)
        {
            return new Bounds(root.transform.position, Vector3.zero);
        }
        Bounds bounds = renderers[0].bounds;
        for (int i = 1; i < renderers.Length; i++)
        {
            bounds.Encapsulate(renderers[i].bounds);
        }
        return bounds;
    }

    /// Moves a spawned model so its lowest point sits on the given height.
    public static void Ground(GameObject instance, float y = 0f)
    {
        Bounds bounds = MeshBounds(instance);
        instance.transform.position += Vector3.up * (y - bounds.min.y);
    }

    public enum Axis
    {
        Largest,
        X,
        Y,
        Z,
    }
}
